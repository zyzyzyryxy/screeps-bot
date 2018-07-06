const WHITELIST = ['cazantyl', 'NobodysNightmare', 'Baj', 'likeafox', 'Invader'];

/* Raid orders:  */
const RAID_DRAIN = 'drain'; // drain tower energy, keep near edge until this is done, withdraw to neighboring room if damaged too much
const RAID_KILL = 'kill'; // !!kill all reachable creeps. Keep out of range of melee attackers (avoid if range 2, stay if range 3), close in or non-melee creeps
const RAID_PROTECT = 'protect'; // keep near (3?) friendly creeps, attack armed hostiles near the closest friendly creep, share target if possible?
const RAID_DEMOLISH = 'demolish'; // !!destroy any reachable owned structure, except ramparts and controller
const RAID_RAZE = 'raze'; // destroy any reachable destructible structures (meant for remotes - kill roads, containers)
const RAID_BREACH = 'breach'; // !!destroy marked walls/ramparts in order, lowest reachable if no marked left
const RAID_BREACH_WIDE = 'breach_wide'; // destroy first marked / weakest reachable rampart, get closer and use mass_ranged_attack to weaken more than one rampart if possible
const RAID_STOMP = 'stomp'; // destroy construction sites
const RAID_SHARD0 = 'shard0'; // go to shard0
const RAID_SHARD1 = 'shard1'; // go to shard1
const RAID_SHARD2 = 'shard2'; // go to shard2

global.DEFAULT_RAID_ORDERS = [RAID_KILL, RAID_DEMOLISH, RAID_BREACH, RAID_STOMP];
global.CAUTIOUS_RAID_ORDERS = [RAID_DRAIN, RAID_KILL, STRUCTURE_SPAWN, RAID_DEMOLISH, RAID_BREACH];
global.REMOTE_RAID_ORDERS = [RAID_KILL, RAID_RAZE];

const getOrderLength = function(order) {
    switch(order) {
        case RAID_DRAIN: return 1500;
        case RAID_KILL: return 1;
        case RAID_SHARD0: return 50;
        case RAID_SHARD1: return 50;
        case RAID_SHARD2: return 50;
    }
    return 5;
}

const roomEvaluator = {
    getHostilesInRange: function(pos, range) {
        return pos.findInRange(FIND_HOSTILE_CREEPS, range, {
            filter: h => (h.getActiveBodyparts(ATTACK) > 0 || h.getActiveBodyparts(RANGED_ATTACK) > 0) && !_.includes(WHITELIST, h.owner.username)
        });
    }
}

const isHostileBase = function(s) {
    return !_.includes([STRUCTURE_RAMPART, STRUCTURE_CONTROLLER, STRUCTURE_KEEPER_LAIR], s.structureType);
}

const hasRampart = function(s) {
    let other = s.pos.lookFor(LOOK_STRUCTURES);
    let ramparts = _(other).filter(s=>s.structureType == STRUCTURE_RAMPART).size();
    return ramparts != 0;
}

const isHostileBaseNoRampart = function(s) {
    if (!isHostileBase(s)) return false;
    let other =s.pos.lookFor(LOOK_STRUCTURES);
    let ramparts = _(other).filter(s=>s.structureType == STRUCTURE_RAMPART).size();
    return ramparts == 0;
}

const chooseReachableTarget = function(pos, targets) {
    if (targets.length == 0) return null;

    let searchResult = PathFinder.search(pos, targets.map(h => {
        return {pos: h.pos, range: 3};
    }), {maxRooms: 1, roomCallback: function(roomName) {
        let room = Game.rooms[roomName];
        if (room == null) return false;
        let matrix = new PathFinder.CostMatrix;
        room.find(FIND_STRUCTURES).forEach(function(struct) {
            if (struct.structureType == STRUCTURE_ROAD) {
                // Favor roads over plain tiles
                matrix.set(struct.pos.x, struct.pos.y, 1);
            } else if (struct.structureType !== STRUCTURE_CONTAINER) {
                // Can't walk through non-walkable buildings
                matrix.set(struct.pos.x, struct.pos.y, 0xff);
            }
        });
        return matrix;
    }});

    if (searchResult.incomplete) return null;
    let visual = Game.rooms[pos.roomName].visual;
    let attackPos = searchResult.path.length == 0 ? pos : _.last(searchResult.path);
    let target = attackPos.findClosestByRange(targets);
    visual.circle(target.pos, {fill: 'transparent', radius: 1.55, stroke: 'red'});
    if (searchResult.path.length > 0) visual.poly(searchResult.path);
    return {attackPos: attackPos, targetId: target.id};
}

const findKillTarget = function(pos) {
    let targets = Game.rooms[pos.roomName].find(FIND_HOSTILE_CREEPS, {
        filter: h => !_.includes(WHITELIST, h.owner.username)
    });
    return chooseReachableTarget(pos, targets);
}

const findDemolishTarget = function(pos) {
    let targets = Game.rooms[pos.roomName].find(FIND_HOSTILE_STRUCTURES, {
        filter: isHostileBaseNoRampart
    });
    
    let target = chooseReachableTarget(pos, targets);
    
    if (target == null) {
        targets = Game.rooms[pos.roomName].find(FIND_HOSTILE_STRUCTURES, {
            filter: isHostileBase
        });
        target = chooseReachableTarget(pos, targets);
    }

    return target;
}

const findTargetOfType = function(pos, structureType) {
    let targets = Game.rooms[pos.roomName].find(FIND_STRUCTURES, {
        filter: s=> s.structureType == structureType && !hasRampart(s)
    });

    let target = chooseReachableTarget(pos, targets);
    
    if (target == null) {
        targets = Game.rooms[pos.roomName].find(FIND_STRUCTURES, {
            filter: s=> s.structureType == structureType
        });
        target = chooseReachableTarget(pos, targets);
    }

    return target;
}

const findInterShard = function(creep, destinationShard) {
    let target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: s=> s.structureType == STRUCTURE_PORTAL && s.destination.shard == destinationShard
    });

    return {targetId: 'any', attackPos: target.pos};
}

const findFleeTarget = function(creep) {
    if (creep.hits == creep.hitsMax) return null;

    let towers = creep.room.find(FIND_HOSTILE_STRUCTURES, {filter: {structureType: STRUCTURE_TOWER}});
    if (towers.length == 0) return null;
    let searchResult = PathFinder.search(creep.pos, towers.map(t => {
        return {pos: t.pos, range: TOWER_FALLOFF_RANGE};
    }), {maxRooms: 1, flee: true, roomCallback: function(roomName) {
        let room = Game.rooms[roomName];
        if (room == null) return false;
        let matrix = new PathFinder.CostMatrix;
        room.find(FIND_STRUCTURES).forEach(function(struct) {
            if (struct.structureType == STRUCTURE_ROAD) {
                // Favor roads over plain tiles
                matrix.set(struct.pos.x, struct.pos.y, 1);
            } else if (struct.structureType !== STRUCTURE_CONTAINER) {
                // Can't walk through non-walkable buildings
                matrix.set(struct.pos.x, struct.pos.y, 0xff);
            }
        });
        return matrix;
    }});

    let fleePos;
    if (searchResult.incomplete) {
        fleePos = creep.memory.lastEntry;
        let exits = Game.map.describeExits(fleePos.roomName);
        if (fleePos.x == 0) {
            fleePos.x = 48;
            fleePos.roomName = exits[FIND_EXIT_LEFT];
        } else if (fleePos.y == 0) {
            fleePos.y = 48;
            fleePos.roomName = exits[FIND_EXIT_TOP];
        } else if (fleePos.x == 49) {
            fleePos.x = 1;
            fleePos.roomName = exits[FIND_EXIT_RIGHT];
        } else if (fleePos.y == 49)  {
            fleePos.y = 1;
            fleePos.roomName = exits[FIND_EXIT_BOTTOM];
        }
    } else {
        fleePos = _.last(searchResult.path);
    };
    if (fleePos == null) {
        fleePos = creep.pos;
    }
    return {targetId: 'any', attackPos: fleePos};
}

const findStompTarget = function(creep) {
    let sites = creep.room.find(FIND_HOSTILE_CONSTRUCTION_SITES,  {filter: cs => {
        if (cs.pos.lookFor(LOOK_MINERALS).length > 0) return false;
        let structs = cs.pos.lookFor(LOOK_STRUCTURES);
        for (let i = structs.length - 1; i >= 0; --i) {
            if ([STRUCTURE_ROAD, STRUCTURE_CONTAINER].indexOf(structs[i].structureType) == -1) return false;
        }
        return true;
    }});
    if (sites.length == 0) return null;
    let searchResult = PathFinder.search(creep.pos, sites.map(t => {
        return {pos: t.pos, range: 0};
    }), {maxRooms: 1, roomCallback: function(roomName) {
        let room = Game.rooms[roomName];
        if (room == null) return false;
        let matrix = new PathFinder.CostMatrix;
        room.find(FIND_STRUCTURES).forEach(function(struct) {
            if (struct.structureType == STRUCTURE_ROAD) {
                // Favor roads over plain tiles
                matrix.set(struct.pos.x, struct.pos.y, 1);
            } else if (struct.structureType !== STRUCTURE_CONTAINER) {
                // Can't walk through non-walkable buildings
                matrix.set(struct.pos.x, struct.pos.y, 0xff);
            }
        });
        return matrix;
    }});

    let stompPos = _.last(searchResult.path);
    return {targetId: 'any', attackPos: stompPos};
}

const findBreachTarget = function(creep) {
    let breachPoints = creep.room.memory.breachPoints;
    for (let i in breachPoints) {
        //TODO: choose first existing and inside current room
        let breachPos = tools.loadPos(breachPoints[i]);
        if (breachPos.roomName != creep.room.name) continue;
        let structs = breachPos.lookFor(LOOK_STRUCTURES);
        if (structs == null || structs.length == 0) continue;
        let walls = _(structs).filter(s=>s.structureType == STRUCTURE_RAMPART || s.structureType == STRUCTURE_WALL);
        if (walls.size() > 0) {
            return chooseReachableTarget(creep.pos, walls.value());
        }
    }
    return null;
}

const findLab = function(creep) {
    let lab = null;
    let boostCount = creep.memory.boostsToApply.length;
    if (boostCount == 0) return null;
    for (let i = 0; i < boostCount; ++i) {
        let nextBoost = creep.memory.boostsToApply[0];
        let labs = creep.room.find(FIND_MY_STRUCTURES, {filter: {structureType: STRUCTURE_LAB, mineralType: nextBoost}});
        if (labs.length > 0) {
            lab = creep.pos.findClosestByPath(labs);
            break;
        }
    }
    if (lab == null) {
        console.log(creep+'cannot boost with any of '+creep.memory.boostsToApply);
        return null;
    }
    return lab;
}

const orderHandler = {
    findOrderTarget: function(creep, order) {
        //TODO: find possible target/targets and return all data about it in order-specific object or null/undefined if no target found
        // returned object should be persistable in memory
        let orderDetails = undefined;
        switch (order) {
            case RAID_DRAIN:
                orderDetails = findFleeTarget(creep);
                break;
            case RAID_KILL:
                orderDetails = findKillTarget(creep.pos);
                break;
            case RAID_DEMOLISH:
                orderDetails = findDemolishTarget(creep.pos);
                break;
            case RAID_BREACH:
                orderDetails = findBreachTarget(creep);
                break;
            case RAID_STOMP:
                orderDetails = findStompTarget(creep);
                break;
            default:
                if (CONTROLLER_STRUCTURES[order] != null) {
                    orderDetails = findTargetOfType(creep.pos, order);
                } else if (order.startsWith('shard')) {
                    orderDetails = findInterShard(creep, order);
                }
        }
        if (orderDetails != null) {
            orderDetails.order = order;
            creep.say(order);
        }
        return orderDetails;
    },
    executeOrder: function(creep, orderDetails) {
/*        switch(orderDetails.order) {
            case RAID_STOMP:
                //move to pos, attack any target in range, finish when at spot
                break;
            case RAID_DRAIN:
                //move to pos, attack any target in range, finish when at full health
                break;
            case RAID_KILL:
                // move to target, attack target or mass attack if near, finish when no target
                break;
            default:
                // move to pos, attack target or mass attack if near and target owned, finish when no target
                break;
        }*/
        let target = orderDetails.targetId == 'any'?
            creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS):
            Game.getObjectById(orderDetails.targetId);
        if (target == null || !creep.pos.inRangeTo(target, 3)) {
            let structsNear = creep.pos.findInRange(FIND_HOSTILE_STRUCTURES, 2);
            if (structsNear.length > 0) creep.rangedMassAttack();
        }
        let destPos = tools.loadPos(orderDetails.attackPos);
        if (target == null && orderDetails.targetId != 'any') return true; //finished
        if (target != null && creep.pos.inRangeTo(target, 3)) {
            if (creep.pos.isNearTo(target) && target.owner != null) {
                creep.rangedMassAttack();
            } else {
                creep.rangedAttack(target);
            }
            if (orderDetails.order == RAID_KILL && creep.pos.getRangeTo(target) == 3) {
                creep.moveTo(target, {maxRooms: 1, ignoreCreeps: true, visualizePathStyle: {stroke: '#ff0000'}});
            }
        } else if (orderDetails.order == RAID_KILL) {
            creep.moveTo(target, {maxRooms: 1, ignoreCreeps: true, visualizePathStyle: {stroke: '#ff0000'}});
        }
        if (orderDetails.order != RAID_KILL) {
            creep.moveTo(destPos, {maxRooms: 1, ignoreCreeps: true, visualizePathStyle: {stroke: '#ffff00'}});
        }
        return orderDetails.order != RAID_DRAIN && creep.pos.isEqualTo(destPos) || orderDetails.order == RAID_DRAIN && creep.hits == creep.hitsMax;
    }
}

const findBestBodySpec = function(raid) {
    let estimatedDamage = raid.estimatedDamage;
    if (estimatedDamage == null) {
        return {tough: 0, ranged: 8, move: 25, heal: 17};
    }
    let bodySpec = {};
    if (raid.boostLvl == 0) {
        bodySpec.heal = Math.ceil(estimatedDamage / HEAL_POWER);
        if (bodySpec.heal >= 25) return "Unboosted creep can't handle that much damage!";
        bodySpec.tough = 0;
        bodySpec.move = 25;
        bodySpec.ranged = 25 - bodySpec.heal;
    } else {
        const idx = raid.boostLvl - 1;
        bodySpec.move = [17, 13, 10][idx];
        const nonMoveParts = [33, 37, 40][idx];
        estimatedDamage *= [0.7, 0.5, 0.3][idx];
        bodySpec.tough = Math.ceil(estimatedDamage / 100);
        bodySpec.heal = Math.ceil(estimatedDamage / HEAL_POWER / (1 + raid.boostLvl));
        bodySpec.ranged = nonMoveParts - bodySpec.tough - bodySpec.heal;
        if (bodySpec.ranged <= 0) {
            return "No place for RANGED_ATTACK! At boost lvl "+raid.boostLvl+" creep can have "+nonMoveParts+" parts, but to survive "+raid.estimatedDamage+
                " it needs "+bodySpec.tough+" TOUGH and "+bodySpec.heal+" HEAL.";
        }
    }
    return bodySpec;
}

//Memory.rooms.<...>.raids = [{target: 'W1S91', maxRaids: 1, boostLvl: 0, priorities: [RAID_DRAIN, STRUCTURE_TOWER], body: {tough: 0, ranged: 8, move: 25, heal: 17}}];
global.raider = {
    createMemory: function(raid, bodySpec) {
        let memory = {role: 'raider', targetRoom: raid.target, boostsToApply: [], priorities: raid.priorities, presetEntrances: raid.presetEntrances};
        if (raid.boosts) {
            memory.boostsToApply = raid.boosts;
        } else if (raid.boostLvl > 0) {
            let idx = raid.boostLvl - 1;
            memory.boostsToApply.push(['ZO', 'ZHO2', 'XZHO2'][idx]);
            if (bodySpec.tough > 0) {
                memory.boostsToApply.push(['GO', 'GHO2', 'XGHO2'][idx]);
            }
            if (bodySpec.heal > 0) {
                memory.boostsToApply.push(['LO', 'LHO2', 'XLHO2'][idx]);
            }
            if (bodySpec.ranged > 0) {
                memory.boostsToApply.push(['KO', 'KHO2', 'XKHO2'][idx]);
            }
        }
        if (raid.additionalTargets != null) {
            memory.additionalTargets = raid.additionalTargets;
        }
        
        return memory;
    },
    planSpawn: function(homeRoom, name, raid, delay) {
        if (homeRoom == null) {
            return 'planSpawn(homeRoom, name, raid, delay); raid = {target, additionalTargets = undefined, priorities = DEFAULT_RAID_ORDERS, boostLvl = 0, estimatedDamage = undefined, body={heal, tough, move, ranged}, presetExits{roomName: pos}}';
        }
        if (!Game.map.isRoomAvailable(homeRoom)) return 'No such home room: '+homeRoom;
        if (!Game.map.isRoomAvailable(raid.target)) return 'No such target room: '+raid.target;
        if (raid.priorities == null) raid.priorities = DEFAULT_RAID_ORDERS;
        if (raid.boostLvl == null) raid.boostLvl = 0;
        let bodySpec = undefined;
        if (raid.body != null) {
            bodySpec = raid.body;
        } else {
            bodySpec = findBestBodySpec(raid);
            if (bodySpec.heal == null) return bodySpec; // This is an error message, not bodySpec in that case
        }
        let room = Game.rooms[homeRoom];
        if (room == null) return 'Home room unvisible!';

        let memory = this.createMemory(raid, bodySpec);
        let body = tools.createBodyFromParts([
            {part: TOUGH, count: bodySpec.tough},
            {part: RANGED_ATTACK, count: bodySpec.ranged},
            {part: MOVE, count: bodySpec.move},
            {part: HEAL, count: bodySpec.heal}]);
        
        if (delay != null) {
            Memory.futureSpawns.push({minTime: Game.time + delay, fromRoom: homeRoom, body: body, name: name, memory: memory});
            return JSON.stringify(Memory.futureSpawns);
        } else {
            room.memory.spawnQueue.push({body: body, name: name, memory: memory});
            return JSON.stringify(room.memory.spawnQueue);
        }
    },
    calculateBody: function(boostLvl, damage) {
        let raid = {estimatedDamage: damage, boostLvl: boostLvl};
        let bodySpec = findBestBodySpec(raid);
        if (bodySpec.heal == null) return bodySpec;
        return "For damage "+damage+" hits per turn and T"+boostLvl+" boosts, raider will have "+
            bodySpec.tough+" TOUGH, "+
            bodySpec.ranged+" RANGED_ATTACK, "+
            bodySpec.move+" MOVE, "+
            bodySpec.heal+" HEAL";
    }
}

let states = {
    init: function(creep) {
        if (creep.spawning) return;
        if (creep.memory.boostsToApply != null && creep.memory.boostsToApply.length > 0) {
            creep.memory.state = 'boost';
            this.boost(creep);
        } else {
            creep.memory.state = 'findPath';
            this.findPath(creep);
        }
    },
    boost: function(creep) {
        let lab = Game.getObjectById(creep.memory.labId);
        if (lab == null) {
            lab = findLab(creep);
            creep.memory.labId = lab;
        }
        if (lab == null) {
            creep.memory.state = 'findPath';
            return this.findPath(creep);
        }
        if (creep.pos.isNearTo(lab) && lab.boosting == null) {
            lab.boosting = creep;
            lab.boostCreep(creep);
            creep.memory.boostsToApply.shift();
            creep.memory.labId = null;
        } else {
            creep.moveTo(lab, {maxRooms: 1, visualizePathStyle: {stroke: '#00ff00'}});
        }
    },
    findPath: function(creep) {
        creep.notifyWhenAttacked = false;
        if (creep.memory.targetRoom != creep.room.name) {
            creep.memory.roomPath = Game.map.findRoute(creep.room, creep.memory.targetRoom, {
                routeCallback(roomName, fromRoomName) {
                    if(Memory.roomsToAvoid != null && Memory.roomsToAvoid.indexOf(roomName) != -1) {
                        return Infinity;
                    }
                    return (new RegExp('((W|E)[0-9]*0.*|(W|E)[0-9]*(N|S)[0-9]*0)')).test(roomName)?2:3;
                }
            });
            if (creep.memory.presetEntrances != null) {
                const lastStep = creep.memory.roomPath[creep.memory.roomPath.length - 1];
                lastStep.exitPos = creep.memory.presetEntrances[lastStep.room];
            }
            creep.memory.state = 'goNextRoom';
            return this.goNextRoom(creep);
        } else {
            creep.memory.state = 'chooseAction';
            return this.chooseAction(creep);
        }
    },
    goNextRoom: function(creep) {
        if (creep.memory.roomPath == -2) creep.memory.roomPath = [];
        // go to target room, leave exit if standing on one, choose action if reached final room.
        // Heal if enemies in range or not seeing anything yet (new room) TODO: check if it is still the case?
        if (creep.pos.x == 0) {
            creep.move(RIGHT);
            creep.heal(creep);
            creep.memory.lastEntry = creep.pos;
        } else if (creep.pos.x == 49) {
            creep.move(LEFT);
            creep.heal(creep);
            creep.memory.lastEntry = creep.pos;
        } else if (creep.pos.y == 0) {
            creep.move(BOTTOM);
            creep.heal(creep);
            creep.memory.lastEntry = creep.pos;
        } else if (creep.pos.y == 49) {
            creep.move(TOP);
            creep.heal(creep);
            creep.memory.lastEntry = creep.pos;
        } else {
            if (creep.memory.roomPath.length > 0 && creep.room.name == creep.memory.roomPath[0].room) {
                creep.memory.roomPath.shift();
            }
            if (creep.memory.roomPath.length == 0) {
                creep.memory.state = 'chooseAction';
                return this.chooseAction(creep);
            }
            if (creep.memory.roomPath[0].exitPos == null) {
                if (creep.room.memory.preferredExits == null || creep.room.memory.preferredExits[creep.memory.roomPath[0].exit] == null) {
                    creep.memory.roomPath[0].exitPos = creep.pos.findClosestByPath(creep.memory.roomPath[0].exit);
                } else {
                    creep.memory.roomPath[0].exitPos = creep.room.memory.preferredExits[creep.memory.roomPath[0].exit];
                }
            }
            creep.moveTo(tools.loadPos(creep.memory.roomPath[0].exitPos), {maxRooms: 1, visualizePathStyle: {stroke: '#ffffff'}});
            if ((creep.room.find(FIND_HOSTILE_STRUCTURES).length > 0) || (creep.pos.findInRange(FIND_HOSTILE_CREEPS, 3).length > 0)) {
                creep.heal(creep);
            }
        }
        if (creep.room.name === creep.memory.targetRoom) {
            creep.rangedMassAttack();
        }
    },
    chooseAction: function(creep) {
        if (creep.room.name != creep.memory.targetRoom) {
            creep.memory.state = 'findPath';
            return this.findPath(creep);
        }
        // check orders, choose one of the available, init action parameters if needed
        if (creep.room.controller == null || creep.room.controller.safeMode == null && !creep.room.controller.my) {
            for (let p in creep.memory.priorities) {
                let order = creep.memory.priorities[p];
                creep.memory.currentOrderDetails = orderHandler.findOrderTarget(creep, order);
                if (creep.memory.currentOrderDetails != null) {
                    creep.memory.currentOrderDetails.order = order;
                    creep.memory.followToTick = Game.time + getOrderLength(order);
                    creep.memory.state = 'followOrder';
                    return this.followOrder(creep);
                }
            }
        }
        if (creep.room.controller != null && creep.room.controller.safeMode != null && !creep.room.controller.my) {
            if (Memory.roomsToAvoid.indexOf(creep.room.name) == -1) Memory.roomsToAvoid.push(creep.room.name);
        }
        creep.heal(creep);
        if (creep.room.name == creep.memory.targetRoom && creep.memory.additionalTargets != null && creep.memory.additionalTargets.length > 0) {
            creep.memory.targetRoom = creep.memory.additionalTargets.shift();
        }
        creep.say('no target');
    },
    followOrder: function(creep) {
        if (Game.time >= creep.memory.followToTick) {
            return this.chooseAction(creep);
        }
        creep.heal(creep);
        let hostilesNear = roomEvaluator.getHostilesInRange(creep.pos, 3);
        
        if (hostilesNear.length > 0) {
            let target = _.min(hostilesNear, 'hits');
            let massValue = _.sum(hostilesNear, h => {
                switch(creep.pos.getRangeTo(h)) {
                    case 1: return 10;
                    case 2: return 4;
                    case 3: return 1;
                    default: return 0;
                }
            });
            if (massValue >= 10) creep.rangedMassAttack();
            else creep.rangedAttack(target);
            let meleeHostiles = _(hostilesNear).filter(h => h.getActiveBodyparts(ATTACK) > 0).value();
            if (meleeHostiles.length > 0) {
                let escape = PathFinder.search(creep.pos, meleeHostiles.map(h => { return {pos: h.pos, range: 3}; } ), {maxRooms: 1, flee: true});
                creep.moveByPath(escape.path);
                creep.say('Stay away!', true);
            }
        } else {
            let finished = orderHandler.executeOrder(creep, creep.memory.currentOrderDetails);
            if (finished) {
                creep.memory.state = 'chooseAction';
            }
        }
    }
}

module.exports = {
    run: function(creep) {
        if (creep.memory == null) {
            console.log('   no memory -> read room orders');
            if (creep.room.memory == null || creep.room.memory.raid == null) {
                console.log('Raider '+creep+' waiting for orders in Memory.rooms.'+creep.room.name+'.raid');
                return;
            }
            creep.memory = creep.room.memory.raid;
            creep.memory.state = 'findPath';
        }
        if (creep.memory.state == null) {
            console.log('   no state -> set init');
            creep.memory.state = 'init';
        }
        states[creep.memory.state](creep);
    },
    describeTarget: function(creep) {
        return 'room '+creep.memory.targetRoom;
    }
};