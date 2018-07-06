const WHITELIST = ['cazantyl', 'NobodysNightmare', 'Baj', 'likeafox'];

let findObstacle = function(pos) {
    let structs = pos.lookFor(LOOK_STRUCTURES);
    if (structs.length == 0) return null;
    structs = _(structs).filter((s) => [STRUCTURE_ROAD, STRUCTURE_CONTAINER, STRUCTURE_CONTROLLER].indexOf(s.structureType) == -1).value();
    if (structs.length > 0) {
        return structs[0]
    } else {
        return null;
    }
}

let chooseWaypoint = function(room, waypoint) {
    if (waypoint == null) {
        if (room.memory.gatherPos==null) return 'No gathering waypoint set!';
        waypoint = room.memory.gatherPos;
    }
    if (waypoint.pos != null) waypoint = waypoint.pos;
    if (waypoint!=null && room.memory.gatherPos==null) {
        room.memory.gatherPos = waypoint;
    }
    return waypoint;
}


let nonAttacking = [];
let primaryTargets = [];

let worthAttacking = function(structure) {
    if (primaryTargets.length > 0) return primaryTargets.indexOf(structure.id) > -1;
    return nonAttacking.indexOf(structure.id) == -1 &&
        [STRUCTURE_ROAD, STRUCTURE_CONTAINER, STRUCTURE_CONTROLLER, STRUCTURE_KEEPER_LAIR, STRUCTURE_PORTAL, STRUCTURE_WALL, STRUCTURE_RAMPART].indexOf(structure.structureType) == -1;
}

let attackFromRange = function(creep, backupTarget) {
    let enemyFilter = {filter: (c) => WHITELIST.indexOf(c.owner.username) == -1};
    let allyFilter = {filter: (c) => WHITELIST.indexOf(c.owner.username) != -1};

    let enemiesInRange = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 3, enemyFilter);
    let alliesInRange = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 3, allyFilter);
    if (enemiesInRange.length > 1 && alliesInRange.length == 0) {
        creep.rangedMassAttack();
    } else {
        if (enemiesInRange.length > 0) {
            creep.rangedAttack(enemiesInRange[0]);
        } else if (backupTarget) {
            creep.rangedAttack(backupTarget);
        }
    }
}

let checkIds = function(ids) {
    if (!ids || ids.length == 0) return [];
    let result = [];
    for(let i in ids) {
        let target = Game.getObjectById(ids[i]);
        if (target) result.push(ids[i]);
    }
    return result;
}

let moveWithFollowers = function(creep, target) {
    if (tools.isPositionInsideRoom(creep.pos, creep.pos.roomName)) {
        for (let i in creep.memory.followers) {
            let follower = Game.creeps[creep.memory.followers[i]];
            if (follower && (follower.fatigue > 0 || !creep.pos.inRangeTo(follower, i+1))) return;
        }
        creep.moveTo(target);
    } else {
        creep.moveTo(target);
    }
}

let warriorNeedingMedic = function(creep) {
    return creep.memory.role == 'warrior' && creep.memory.followers.length < creep.memory.minFollowers;
}

let loadBreachpoint = function(creep, posFromMem) {
    creep.breachPoint = tools.loadPos(posFromMem);
    if (creep.breachPoint.roomName in Game.rooms) {
        creep.obstacle = findObstacle(creep.breachPoint);
        if (creep.obstacle) {
            creep.memory.currentTargetId = creep.obstacle.id;
        }
    }
}

let controller = {
    nextAction: {
        boost: function(creep) {
            return creep.memory.boostsToApply.length == 0?'gather':'boost';
        },
        gather: function(creep) {
            creep.gatherPos = tools.loadPos(creep.memory.stagingPos);
            if (creep.memory.healer && creep.pos.isNearTo(creep.gatherPos)) return this.waitForLeader(creep);
            return creep.pos.isEqualTo(creep.gatherPos)?this.waitForTeam(creep):'gather';
        },
        waitForLeader: function(creep) {
            if ('follow' in creep.memory) return 'follow';
            let leaders = creep.pos.findInRange(FIND_MY_CREEPS, 1, { filter: warriorNeedingMedic });
            if (leaders.length == 0) {
                return 'waitForLeader';
            }
            creep.leader = leaders[0];
            creep.memory.follow = leaders[0].name;
            leaders[0].memory.followers.push(creep.name);
            return 'follow';
        },
        follow: function(creep) {
            if (creep.memory.follow in Game.creeps) {
                creep.leader = Game.creeps[creep.memory.follow];
            } else {
                creep.leader = creep.pos.findClosestByPath(FIND_MY_CREEPS, { filter: warriorNeedingMedic });
            }
            return 'follow';
        },
        waitForTeam: function(creep) {
            return (creep.memory.followers.length >= creep.memory.minFollowers)?'breach':'waitForTeam';
        },
        breach: function(creep) {
            let breachPoints = creep.memory.breachPath;
            if (!breachPoints) {
                let pathToCopy = Memory.rooms[creep.memory.targetRoom].breachPoints;
                if (pathToCopy) creep.memory.breachPath = JSON.parse(JSON.stringify(pathToCopy));
                else creep.memory.breachPath = [creep.pos];
                breachPoints = creep.memory.breachPath;
            }
            if (!breachPoints) {
                console.log(creep+' did not find breach path for room '+creep.memory.targetRoom);
                return 'withdraw';
            }
            while (breachPoints.length > 0) {
                loadBreachpoint(creep, breachPoints[0]);
                if (creep.pos.isEqualTo(creep.breachPoint)) {
                    breachPoints.shift();
                } else {
                    return 'breach';
                }
            }
            return this.chooseAttackMethod(creep);
        },
        chooseAttackMethod: function(creep) {
            if (creep.room.name == creep.memory.targetRoom) {
                if (creep.getActiveBodyparts(RANGED_ATTACK) > 0) return this.support(creep);
                if (creep.getActiveBodyparts(ATTACK) > 0) return 'hunt';
                if (creep.getActiveBodyparts(WORK) > 0) return 'raze';
                return 'chooseAttackMethod';
            } else {
                console.log(creep+' finished breach path in a wrong room: '+creep.room.name+' instead of '+creep.memory.targetRoom);
                return 'breach';
            }
        },
        support: function(creep) {
            if (creep.memory.leader in Game.creeps) {
                creep.leader = Game.creeps[creep.memory.leader];
                creep.target = Game.getObjectById(creep.leader.memory.currentTargetId);
                let leaderFollowers = creep.leader.memory.followers;
                if (leaderFollowers.length > 0) {
                    creep.follow = Game.creeps[leaderFollowers[0]];
                } else {
                    creep.follow = creep.leader;
                }
            } else {
                return 'withdraw';
            }
            if (creep.room.controller && creep.room.controller.safeMode){
                Game.notify('Creep withdrawing from room '+creep.room.name+' due to safe mode.');
                console.log('Creep withdrawing from room '+creep.room.name+' due to safe mode.');
                return 'withdraw';
            } else {
                return 'support';
            }
        },
        hunt: function(creep) {
            if (creep.room.controller && creep.room.controller.safeMode){
                Game.notify('Creep withdrawing from room '+creep.room.name+' due to safe mode.');
                console.log('Creep withdrawing from room '+creep.room.name+' due to safe mode.');
                return 'withdraw';
            } else {
                return 'hunt';
            }
        },
        raze: function(creep) {
            if (creep.room.controller && creep.room.controller.safeMode) {
                Game.notify('Creep withdrawing from room '+creep.room.name+' due to safe mode.');
                console.log('Creep withdrawing from room '+creep.room.name+' due to safe mode.');
                return 'withdraw';
            } else {
                return 'raze';
            }
        },
        withdraw: function(creep) {
            creep.spawn = Game.rooms[creep.memory.homeRoom].find(FIND_MY_SPAWNS)[0];
            return 'withdraw';
        }
    },
    performAction: {
        boost: function(creep) {
            let nextBoost = creep.memory.boostsToApply[0];
            let labs = creep.room.find(FIND_MY_STRUCTURES, {filter: {structureType: STRUCTURE_LAB, mineralType: nextBoost}});
            if (labs.length == 0) {
                console.log(creep+'cannot boost with '+nextBoost);
                creep.memory.boostsToApply.push(creep.memory.boostsToApply.shift());
                return;
            }
            if (creep.pos.isNearTo(labs[0]) && labs[0].boosting == null) {
                labs[0].boosting = creep;
                labs[0].boostCreep(creep);
                creep.memory.boostsToApply.shift();
            } else {
                creep.moveTo(labs[0]);
            }
        },
        gather: function(creep) {
            creep.moveTo(creep.gatherPos, {ignoreRoads: true, visualizePathStyle: {stroke: '#ffffff'}});
        },
        waitForLeader: function(creep) {
            null;
        },
        follow: function(creep) {
            creep.moveTo(creep.leader, {ignoreRoads: true, reusePath: 0});
            let healPower = _.sum(creep.body.map((part) => part.type==HEAL?(part.boost?(BOOSTS[part.type][part.boost].heal*HEAL_POWER):HEAL_POWER):0 ));
            let wounded = creep.pos.findInRange(FIND_MY_CREEPS, 1, {filter: c=>c.hits < c.hitsMax});
            if (wounded.length > 0) {
                wounded.sort(function(a,b) {return Math.max(a.hitsMax - a.hits, 0) - Math.max(b.hitsMax - b.hits, 0);});
                creep.heal(wounded[0]);
            } else {
                wounded = creep.pos.findInRange(FIND_MY_CREEPS, 3, {filter: c=>c.hits < c.hitsMax});
                if (wounded.length > 0) {
                    wounded.sort(function(a,b) {return Math.max(a.hitsMax - a.hits, 0) - Math.max(b.hitsMax - b.hits, 0);});
                    creep.rangedHeal(wounded[0]);
                } else {
                    if (creep.leader) creep.heal(creep.leader);
                    else creep.heal(creep);
                }
            }
        },
        waitForTeam: function(creep) {
            null;
        },
        breach: function(creep) {
            moveWithFollowers(creep, creep.breachPoint);
            let hostiles = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 1);
            if (creep.getActiveBodyparts(ATTACK) > 0 && hostiles.length > 0) {
                hostiles.sort((function(a,b) {return a.getActiveBodyparts(ATTACK) - b.getActiveBodyparts(ATTACK)} ));
                creep.attack(hostiles[0]);
            }
            if (hostiles.length == 0) {
                let target = creep.pos.isNearTo(creep.obstacle)?creep.obstacle:creep.pos.findInRange(FIND_HOSTILE_STRUCTURES, 1)[0];
                if (target != null) {
                    let attackPower = creep.getActiveBodyparts(ATTACK) * ATTACK_POWER;
                    let dismantlePower = creep.getActiveBodyparts(WORK) * DISMANTLE_POWER;
                    if (attackPower >= dismantlePower) {
                        creep.attack(creep.obstacle);
                    } else if (dismantlePower > 0) {
                        creep.dismantle(creep.obstacle);
                    }
                }
            }
            if (creep.getActiveBodyparts(RANGED_ATTACK) > 0) {
                attackFromRange(creep, creep.obstacle);
            }
        },
        chooseAttackMethod: function(creep) {
        },
        support: function(creep) {
            attackFromRange(creep, creep.target);
            creep.moveTo(creep.follow);
        },
        hunt: function(creep) {
            if (creep.getActiveBodyparts(RANGED_ATTACK > 0)) {
                attackFromRange(creep, null);
            }
            let enemyFilter = {filter: (c) => WHITELIST.indexOf(c.owner.username) == -1 && tools.isPositionInsideRoom(c.pos, c.pos.roomName)};
            let targets = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 1, enemyFilter);
            if (targets.length > 0) {
                creep.attack(targets[0]);
            } else {
                let target = creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS, enemyFilter);
                if (target) {
                    moveWithFollowers(creep, target);
                } else {
                    this.raze(creep, 'attack');
                }
            }
        },
        raze: function(creep, attackMethod) {
            if (!attackMethod) attackMethod = 'dismantle';
            nonAttacking = ('nonTargets' in Memory.rooms[creep.pos.roomName])?Memory.rooms[creep.pos.roomName].nonTargets:[];
            primaryTargets = checkIds(Memory.rooms[creep.pos.roomName].primaryTargets);
            let targets = creep.pos.findInRange(FIND_STRUCTURES, 1, {filter: worthAttacking});
            if (targets.length > 0) {
                creep[attackMethod](targets[0]);
            } else {
                let target = creep.pos.findClosestByPath(FIND_STRUCTURES, {filter: worthAttacking});
                if (!target) target = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, {filter: {structureType: STRUCTURE_RAMPART}});
                if (!target) target = creep.pos.findClosestByPath(FIND_STRUCTURES, {filter: {structureType: STRUCTURE_WALL}});
                if (target) {
                    moveWithFollowers(creep, target);
                    creep[attackMethod](target);
                }
            }
        },
        withdraw: function(creep) {
            if (creep.pos.isNearTo(creep.spawn)) {
                creep.spawn.recycleCreep(creep);
            } else {
                creep.moveTo(creep.spawn, {ignoreRoads: true});
                if (creep.hits < creep.hitsMax) {
                    creep.heal(creep);
                }

            }
        }
    }
}

let boostAvailableInRoom = function(room, boostResource) {
    for (let l in room.memory.config.labs.boosters) {
        if (room.memory.config.labs.boosters[l] == boostResource) {
            return true;
        }
    }
    return false;
}

let getMoveEfficiency = function(boosts) {
    let moveEfficiency = 1;
    let boostKinds = 0;
    if (boosts.indexOf(RESOURCE_ZYNTHIUM_OXIDE) > -1) {
        console.log('Found '+RESOURCE_ZYNTHIUM_OXIDE+' boost');
        moveEfficiency = 2;
        ++boostKinds;
    }
    if (boosts.indexOf(RESOURCE_ZYNTHIUM_ALKALIDE) > -1) {
        console.log('Found '+RESOURCE_ZYNTHIUM_ALKALIDE+' boost');
        moveEfficiency = 3;
        ++boostKinds;
    }
    if (boosts.indexOf(RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE) > -1) {
        console.log('Found '+RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE+' boost');
        moveEfficiency = 4;
        ++boostKinds;
    }
    if (boostKinds > 1) console.log('Warning! More than one move boost kind selected!');
    console.log('moveEfficiency is '+moveEfficiency);
    return moveEfficiency;
}

let getToughHits = function(boosts) {
    let toughHits = 100;
    let boostKinds = 0;
    if (boosts.indexOf(RESOURCE_GHODIUM_OXIDE) > -1) {
        toughHits = 100/0.7;
        ++boostKinds;
    }
    if (boosts.indexOf(RESOURCE_GHODIUM_ALKALIDE) > -1) {
        toughHits = 100/0.5;
        ++boostKinds;
    }
    if (boosts.indexOf(RESOURCE_CATALYZED_GHODIUM_ALKALIDE) > -1) {
        toughHits = 100/0.3;
        ++boostKinds;
    }
    if (boostKinds > 1) console.log('Warning! More than one tough boost kind selected!');
    console.log('toughHits is '+toughHits);
    return toughHits;
}

let getDamageReduction = function(boosts) {
    let reduction = 0;
    let boostKinds = 0;
    if (boosts.indexOf(RESOURCE_GHODIUM_OXIDE) > -1) {
        reduction = 0.3;
        ++boostKinds;
    }
    if (boosts.indexOf(RESOURCE_GHODIUM_ALKALIDE) > -1) {
        reduction = 0.5;
        ++boostKinds;
    }
    if (boosts.indexOf(RESOURCE_CATALYZED_GHODIUM_ALKALIDE) > -1) {
        reduction = 0.7;
        ++boostKinds;
    }
    if (boostKinds > 1) console.log('Warning! More than one tough boost kind selected!');
    console.log('Damage reduction is '+reduction);
    return reduction;
}

let getHealPower = function(boosts) {
    let healPower = HEAL_POWER;
    let boostKinds = 0;
    if (boosts.indexOf(RESOURCE_LEMERGIUM_OXIDE) > -1) {
        healPower = HEAL_POWER*2;
        ++boostKinds;
    }
    if (boosts.indexOf(RESOURCE_LEMERGIUM_ALKALIDE) > -1) {
        healPower = HEAL_POWER*3;
        ++boostKinds;
    }
    if (boosts.indexOf(RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE) > -1) {
        healPower = HEAL_POWER*4;
        ++boostKinds;
    }
    if (boostKinds > 1) console.log('Warning! More than one heal boost kind selected!');
    console.log('healPower is '+healPower);
    return healPower;
}

global.warrior = {
    manager: {
        createMemory: function(homeRoom, targetRoom, roleName, stagingPoint, followersCount, boostsList) {
            if (boostsList) {
                return {homeRoom: homeRoom, targetRoom: targetRoom, role: roleName, stagingPos: stagingPoint, minFollowers: followersCount, followers: [], action: 'boost', boostsToApply: boostsList};
            } else {
                return {homeRoom: homeRoom, targetRoom: targetRoom, role: roleName, stagingPos: stagingPoint, minFollowers: followersCount, followers: [], action: 'gather'};
            }
        },
        updateMemory: function(creepName, targetRoom, waypoint) {
            let creep = Game.creeps[creepName];
            if (!creep || creep.memory.role != 'warrior') return creepName+' is not a warrior creep!';
            creep.memory.targetRoom = targetRoom;
            creep.memory.stagingPos = waypoint;
            creep.memory.action = 'gather';
            delete creep.memory.breachPath;
            return 'creep '+creepName+' sent to room '+targetRoom;
        },
        planSpawn: function(room, targetRoomName, toughParts, workParts, attackParts, rangedAttackParts, moveParts, name, waypoint, followersCount, boostsList, leader, delay) {
            waypoint = chooseWaypoint(room, waypoint);
            let body = tools.createBodyFromParts([{part: TOUGH, count: toughParts},
                                                  {part: WORK, count: workParts},
                                                  {part: ATTACK, count: attackParts},
                                                  {part: RANGED_ATTACK, count: rangedAttackParts},
                                                  {part: MOVE, count: moveParts}]);
            if (tools.calcBodyCost(body) > room.energyCapacityAvailable) return 'Body too costly: '+tools.calcBodyCost(body)+' > '+room.energyCapacityAvailable;
            for(let i in boostsList) {
                if (!boostAvailableInRoom(room, boostsList[i])) return 'Boost '+boostsList[i]+' not planned in any lab!';
            }
            let memory = this.createMemory(room.name, targetRoomName, 'warrior', waypoint, followersCount, boostsList);
            if (leader) memory.leader = leader;
            if (delay != null) {
                Memory.futureSpawns.push({minTime: Game.time + delay, fromRoom: room.name, body: body, name: name, memory: memory});
                return JSON.stringify(Memory.futureSpawns);
            } else {
                room.memory.spawnQueue.push({body: body, name: name, memory: memory});
                return JSON.stringify(room.memory.spawnQueue);
            }
        },
        planSpawnMedic: function(room, targetRoomName, toughParts, attackParts, healParts, moveParts, name, waypoint, boostsList, presetFollow, delay) {
            waypoint = chooseWaypoint(room, waypoint);
            let body = tools.createBodyFromParts([{part: TOUGH, count: toughParts}, {part: ATTACK, count: attackParts}, {part: MOVE, count: moveParts}, {part: HEAL, count: healParts}]);
            if (tools.calcBodyCost(body) > room.energyCapacityAvailable) return 'Body too costly: '+tools.calcBodyCost(body)+' > '+room.energyCapacityAvailable;
            for(let i in boostsList) {
                if (!boostAvailableInRoom(room, boostsList[i])) return 'Boost '+boostsList[i]+' not planned in any lab!';
            }
            let memory = this.createMemory(room.name, targetRoomName, 'warrior', waypoint, 0, boostsList);
            memory.healer = true;
            if (presetFollow) {
                memory.follow = presetFollow;
            }
            if (delay != null) {
                Memory.futureSpawns.push({minTime: Game.time + delay, fromRoom: room.name, body: body, name: name, memory: memory});
                return JSON.stringify(Memory.futureSpawns);
            } else {
                room.memory.spawnQueue.push({body: body, name: name, memory: memory});
                return JSON.stringify(room.memory.spawnQueue);
            }
        },
        planSpawnMA: function(room, targetRoomName, name, boosts, expectedDamage, presetFollow, doSpawn, delay) {
            if (!room) return 'room, targetRoomName, name, boosts, expectedDamage, presetFollow, doSpawn, delay';
            const moveEfficiency = getMoveEfficiency(boosts);
            const damageReduction = getDamageReduction(boosts);
            const reducedDamage = expectedDamage * (1-damageReduction);
            console.log('Damage reduced to '+reducedDamage);
            const healPower = getHealPower(boosts);

            const toughSize = (damageReduction == 0) ? 0 : Math.ceil(2*reducedDamage/100);
            console.log('Need '+toughSize+' tough parts');
            let minHealSize = Math.ceil(reducedDamage/healPower);
            console.log('Need at least '+minHealSize+' heal parts');
            const minMoveSize = Math.ceil((toughSize + minHealSize) / moveEfficiency);
            console.log('Need at least '+minMoveSize+' move parts');
            let freeParts = MAX_CREEP_SIZE - toughSize - minHealSize - minMoveSize;
            if (freeParts < 0) {
                console.log('Creep too big to spawn!');
                return 'Too large';
            }
            const minCost = toughSize*BODYPART_COST[TOUGH] + minHealSize*BODYPART_COST[HEAL] + minMoveSize*BODYPART_COST[MOVE];
            let remainingEnergy = room.energyCapacityAvailable - minCost;
            if (remainingEnergy < 0) {
                console.log('Creep cost at least '+minCost+', room '+room.name+' cannot afford that!');
                return 'Too costly';
            }
            let extraPartsForMove = Math.min(minMoveSize * moveEfficiency - toughSize - minHealSize, freeParts);
            if ((extraPartsForMove > 0) && (remainingEnergy >= BODYPART_COST[HEAL])) {
                const addHeal = Math.min(Math.floor(remainingEnergy / BODYPART_COST[HEAL]), extraPartsForMove);
                minHealSize += addHeal;
                remainingEnergy -= addHeal * BODYPART_COST[HEAL];
                freeParts -= addHeal;
            }
            const extraBlocks = Math.floor(Math.min(freeParts / (moveEfficiency + 1), remainingEnergy / (moveEfficiency * BODYPART_COST[HEAL] + BODYPART_COST[MOVE])));
            
            let healSize = minHealSize + extraBlocks * moveEfficiency;
            let moveSize = minMoveSize + extraBlocks;

            console.log('Will load '+healSize+' heal parts');
            console.log('Need '+moveSize+' move parts');

            if (doSpawn) return this.planSpawnMedic(room, targetRoomName, toughSize, 0, healSize, moveSize, name, null, boosts, presetFollow, delay);
            else return 'Heal size: '+healSize+', tough size: '+toughSize+', move size: '+moveSize;
        },
        planSpawnDA: function(room, targetRoomName, name, boosts, expectedDamage, followersCount, doSpawn, delay) {
            if (!room) return 'room, targetRoomName, name, boosts, expectedDamage, followersCount, doSpawn, delay';
            const moveEfficiency = getMoveEfficiency(boosts);
            const damageReduction = getDamageReduction(boosts);
            const reducedDamage = expectedDamage * (1-damageReduction);
            console.log('Damage reduced to '+reducedDamage);

            const toughSize = (damageReduction == 0) ? 0 : Math.ceil(2*reducedDamage/100);
            console.log('Need '+toughSize+' tough parts');

            const minMoveSize = Math.ceil((toughSize + 1) / moveEfficiency);
            console.log('Need at least '+minMoveSize+' move parts');
            let freeParts = MAX_CREEP_SIZE - toughSize - minMoveSize;
            if (freeParts < 1) {
                console.log('Creep too big to spawn!');
                return 'Too large';
            }
            const minCost = toughSize*BODYPART_COST[TOUGH] + minMoveSize*BODYPART_COST[MOVE];
            let remainingEnergy = room.energyCapacityAvailable - minCost;
            if (remainingEnergy < BODYPART_COST[WORK]) {
                console.log('Creep cost at least '+(minCost+BODYPART_COST[WORK])+', room '+room.name+' cannot afford that!');
                return 'Too costly';
            }
            let extraPartsForMove = Math.min(minMoveSize * moveEfficiency - toughSize, freeParts);
            let workSize = 1;
            if ((extraPartsForMove > 1) && (remainingEnergy > BODYPART_COST[WORK])) {
                workSize = Math.min(Math.floor(remainingEnergy / BODYPART_COST[WORK]), extraPartsForMove);
                remainingEnergy -= workSize * BODYPART_COST[WORK];
                freeParts -= workSize;
            }
            const extraBlocks = Math.floor(Math.min(freeParts / (moveEfficiency + 1), remainingEnergy / (moveEfficiency * BODYPART_COST[WORK] + BODYPART_COST[MOVE])));
            
            workSize += extraBlocks * moveEfficiency;
            let moveSize = minMoveSize + extraBlocks;

            if (doSpawn) return this.planSpawn(room, targetRoomName, toughSize, workSize, 0, 0, moveSize, name, null, followersCount, boosts, undefined, delay);
            else return 'Work size: '+workSize+', tough size: '+toughSize+', move size: '+moveSize;
        },
        planSpawnAA: function(room, targetRoomName, name, boosts, expectedDamage, followersCount, doSpawn, delay) {
            if (!room) return 'room, targetRoomName, name, boosts, expectedDamage, followersCount, doSpawn, delay';
            const moveEfficiency = getMoveEfficiency(boosts);
            const damageReduction = getDamageReduction(boosts);
            const reducedDamage = expectedDamage * (1-damageReduction);
            console.log('Damage reduced to '+reducedDamage);

            const toughSize = (damageReduction == 0) ? 0 : Math.ceil(2*reducedDamage/100);
            console.log('Need '+toughSize+' tough parts');

            const minMoveSize = Math.ceil((toughSize + 1) / moveEfficiency);
            console.log('Need at least '+minMoveSize+' move parts');
            let freeParts = MAX_CREEP_SIZE - toughSize - minMoveSize;
            if (freeParts < 1) {
                console.log('Creep too big to spawn!');
                return 'Too large';
            }
            const minCost = toughSize*BODYPART_COST[TOUGH] + minMoveSize*BODYPART_COST[MOVE];
            let remainingEnergy = room.energyCapacityAvailable - minCost;
            if (remainingEnergy < BODYPART_COST[ATTACK]) {
                console.log('Creep cost at least '+(minCost+BODYPART_COST[ATTACK])+', room '+room.name+' cannot afford that!');
                return 'Too costly';
            }
            let extraPartsForMove = Math.min(minMoveSize * moveEfficiency - toughSize, freeParts);
            let attackSize = 1;
            if ((extraPartsForMove > 1) && (remainingEnergy > BODYPART_COST[ATTACK])) {
                attackSize = Math.min(Math.floor(remainingEnergy / BODYPART_COST[ATTACK]), extraPartsForMove);
                remainingEnergy -= attackSize * BODYPART_COST[ATTACK];
                freeParts -= attackSize;
            }
            const extraBlocks = Math.floor(Math.min(freeParts / (moveEfficiency + 1), remainingEnergy / (moveEfficiency * BODYPART_COST[ATTACK] + BODYPART_COST[MOVE])));
            
            attackSize += extraBlocks * moveEfficiency;
            let moveSize = minMoveSize + extraBlocks;

            if (doSpawn) return this.planSpawn(room, targetRoomName, toughSize, 0, attackSize, 0, moveSize, name, null, followersCount, boosts, undefined, delay);
            else return 'Attack size: '+attackSize+', tough size: '+toughSize+', move size: '+moveSize;
        }
    },
    targetting: {
        markPriorityTarget: function(roomName, targetId) {
            if (!(roomName in Memory.rooms)) Memory.rooms[roomName] = {};
            if ('primaryTargets' in Memory.rooms[roomName]) {
                Memory.rooms[roomName].primaryTargets.push(targetId);
            } else {
                Memory.rooms[roomName].primaryTargets = [targetId];
            }
        },
        markNonTarget: function(roomName, structId) {
            if (!(roomName in Memory.rooms)) Memory.rooms[roomName] = {};
            if ('nonTargets' in Memory.rooms[roomName]) {
                Memory.rooms[roomName].nonTargets.push(structId);
            } else {
                Memory.rooms[roomName].nonTargets = [structId];
            }
        },
        setBreachPath: function(roomName, path) {
            if (!(roomName in Memory.rooms)) Memory.rooms[roomName] = {};
            Memory.rooms[roomName].breachPoints = [];
            for (let i in path) {
                let loaded = tools.loadPos(path[i]);
                if (loaded) {
                    Memory.rooms[roomName].breachPoints.push(loaded);
                }
            }
        }
    },
    helpers: {
        calculateTowerDamageAt: function(pos) {
            let room = Game.rooms[pos.roomName];
            if (!room) return 'Room '+pos.roomName+' is not visible';
            let towers = room.find(FIND_STRUCTURES, {filter: {structureType: STRUCTURE_TOWER}});
            let damageTotal = 0;
            for (let i = towers.length - 1; i >= 0; --i) {
                let tower = towers[i];
                let dist = pos.getRangeTo(tower.pos);
                damage = TOWER_POWER_ATTACK * towerControl.towerEfficiencyAtRange(dist);
                console.log(pos + ':' + tower+' in range of '+dist+' will deal '+damage);
                damageTotal += damage;
            }
            return 'total @'+pos+': ' + damageTotal;
        },
        makePathFromNumberedFlags: function(flagNamePrefix, start, end) {
            path = [];
            for (let i = start; i <= end; ++i) {
                path.push(Game.flags[flagNamePrefix+i].pos);
            }
            return path;
        },
        calcPathLength: function(path) {
            let last = path.length - 1;
            if (last <= 0) return "Path is too short";
            let length = 0;
            let from;
            let to = tools.loadPos(path[0]);
            for (let i = 1; i<=last; ++i) {
                from = to;
                to = tools.loadPos(path[i]);
                let part = PathFinder.search(from, to);
                console.log(from+'->'+to+': complete? '+!part.incomplete+', cost: '+part.cost);
                length += part.cost;
            }
            return length;
        }
    }
}

module.exports = {
    run: function(creep) {
        if (creep.spawning) return;
        if (!creep.memory.action || !(creep.memory.action in controller.nextAction)) creep.memory.action = 'gather';
        creep.memory.action = controller.nextAction[creep.memory.action](creep);
        creep.say(creep.memory.action);
        if (creep.memory.action in controller.performAction) controller.performAction[creep.memory.action](creep);
    },
    describeTarget: function(creep) {
        return 'room '+creep.memory.targetRoom;
    }
};