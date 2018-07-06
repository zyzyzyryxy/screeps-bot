require('util.tools');
let towerControl = require('struct.tower');
let linkControl = require('struct.link');
let terminalControl = require('struct.terminal');

global.roles = {
    drone: require('role.drone'),
    remoteDrone: require('role.drone'),
    miner: require('role.miner'),
    collector2: require('role.collector2'),
    upgrader: require('role.worker'),
    claimer: require('role.claimer'),
    guard: require('role.guard'),
    refiller: require('role.refiller'),
    gatherer: require('role.gatherer'),
    scientist: require('role.scientist'),
    scout: require('role.scout'),
    warrior: require('role.warrior'),
    nuker: require('role.nuker'),
    raider: require('role.raider'),
    builder: require('role.builder'),
    racer: require('role.racer')
    };

let getDroneBody = function(energyCap, sizeCap, extraCarry) {
    if (!sizeCap || sizeCap > 16) sizeCap = 16;
    if (extraCarry && sizeCap > 10) sizeCap = 10;
    let unitCost = BODYPART_COST[WORK] + BODYPART_COST[CARRY] + BODYPART_COST[MOVE];
    if (extraCarry) {
        unitCost += BODYPART_COST[CARRY] + BODYPART_COST[MOVE];
    }
    let units = Math.min( Math.floor(energyCap / unitCost), sizeCap);
    if (extraCarry) {
        return tools.createBodyFromParts([{part: WORK, count: units}, {part: CARRY, count: units*2}, {part: MOVE, count: units*2}]);
    } else {
        return tools.createBodyFromParts([{part: WORK, count: units}, {part: CARRY, count: units}, {part: MOVE, count: units}]);
    }
}

let spawnDrones = function(room, spawn) {
    if (!('drones' in room.memory.config)) room.memory.config.drones = {count: 2};
    if (!('count' in room.memory.config.drones)) room.memory.config.drones.count = 2;
    if (!('maxSize' in room.memory.config.drones)) room.memory.config.drones.maxSize = 8;
    let spawnLimit = room.memory.config.drones.count;
    let count = tools.countCreepsFromRoom('drone', room.name);
    if (count >= spawnLimit) return false;
    if (room.energyAvailable < 200) return true; //nothing can be spawned, so...
    let body = getDroneBody(count == 0 ? room.energyAvailable : room.energyCapacityAvailable, room.memory.config.drones.maxSize);
    let memory = roles.drone.manager.createMemory('drone', room.name);
    let name = tools.getCreepName(memory);
    if (spawn.canCreateCreep(body, name) == 0) {
        spawn.createCreep(body, name, memory);
    } else {
        room.memory.spawnQueue.push({body: body, name: name, memory: memory});
    }
    return true;
}

let spawnMiners = function(room, spawn) {
    if (!('mines' in room.memory.config)) room.memory.config.mines = [];
    let mines = room.memory.config.mines;

    let mine = mines.find((m) => {
        let lastSpawn = m.lastSpawn;
        if (!lastSpawn) lastSpawn = 0;
        m.timeSinceRespawn = Game.time - lastSpawn;
        let droppedEnergy = tools.getDroppedResourceAtPos(m.pos, RESOURCE_ENERGY);
        return (m.timeSinceRespawn > m.respawn) && tools.isRoomSafe(m.pos.roomName) && droppedEnergy < 1000 && m.pos.roomName == room.name;
    });
    if (!mine) {
        mine = mines.find((m) => {
            let lastSpawn = m.lastSpawn;
            if (!lastSpawn) lastSpawn = 0;
            m.timeSinceRespawn = Game.time - lastSpawn;
            let droppedEnergy = tools.getDroppedResourceAtPos(m.pos, RESOURCE_ENERGY);
            return (m.timeSinceRespawn > m.respawn) && tools.isRoomSafe(m.pos.roomName) && droppedEnergy < 1000;
        });
    }

    if (mine) {
        let body = tools.createBodyFromParts([{count:mine.moves, part: MOVE}, {count:mine.carry, part: CARRY}, {count:mine.work, part: WORK}]);
        let memory = roles.miner.manager.createMemory('miner', room.name, mine.pos);
        let name = tools.getCreepName(memory);
        let ret = spawn.canCreateCreep(body, name);
        if (ret == 0) {
            spawn.createCreep(body, name, memory);
            mine.lastSpawn = Game.time;
        } else {
            room.memory.spawnQueue.push({body: body, name: name, memory: memory});
            mine.lastSpawn = Game.time + 5;
        }
        return true;
    }
    return false;
}

let spawnTransports = function(room, spawn) {
    if (!('trans' in room.memory.config)) room.memory.config.trans = [];
    let transportNeed = tools.findMostNeededTrans(room.memory.config.trans);
    if (transportNeed) {
        let unloadPos;
        if ('toPos' in transportNeed) unloadPos = transportNeed.toPos;
        else unloadPos = tools.getRoomStore(room).pos;
        collector.manager.doSpawn(room, spawn, transportNeed.fromPos, unloadPos, RESOURCE_ENERGY, transportNeed.carry, transportNeed.moves)
        transportNeed.nextSpawn = Game.time + Math.floor(1500 / transportNeed.count);
        return true;
    }
    return false;
}

let spawnRemoteDrones = function(room, spawner) {
    if (!('maintainRooms' in room.memory.config)) room.memory.config.maintainRooms = {};
    let remoteRooms = room.memory.config.maintainRooms;
    for (r in remoteRooms) {
        Memory.rooms[r].managedFrom = room.name;
        if (!('maxDrones' in remoteRooms[r])) remoteRooms[r].maxDrones = 1;
        if (!('minSize' in remoteRooms[r])) remoteRooms[r].minSize = 1;
        if (!tools.isRoomSafe(r)) continue;
        let sumWork = _(Game.creeps).filter({memory: {role: 'remoteDrone', homeRoom: room.name, targetRoom: r}}).map((c)=>c.getActiveBodyparts(WORK)).sum();
        if (remoteRooms[r].maxDrones > sumWork) {
            let size = remoteRooms[r].maxDrones - sumWork;
            if (size > 0 && size < remoteRooms[r].minSize) size = remoteRooms[r].minSize;
            let body = getDroneBody(room.energyCapacityAvailable, size, remoteRooms[r].extraCarry);
            let memory = roles.remoteDrone.manager.createMemory('remoteDrone', room.name, r);
            let name = tools.getCreepName(memory);
            if (spawner.canCreateCreep(body, name) == 0) {
                spawner.createCreep(body, name, memory);
            } else {
                room.memory.spawnQueue.push({body: body, name: name, memory: memory});
            }
            return true;
        }
    }
    return false;
}

let getBodyCost = function(body) {
    return body.reduce((t,bp) => t + BODYPART_COST[bp], 0);
}

let groupedClaimers = {};

let findRoomToClaimFrom = function(room) {
    if (!('cacheTime' in groupedClaimers) || groupedClaimers.cacheTime < Game.time) {
        groupedClaimers.list = _(Game.creeps).filter({memory: {role: 'claimer'}}).groupBy('memory.targetRoom').value();
        groupedClaimers.cacheTime = Game.time;
    }
    let grouped = groupedClaimers.list;
    let roomsToClaim = [];
    for (roomName in room.memory.config.maintainRooms) {
        if (roomName in grouped) continue;
        if (!Game.rooms[roomName]) continue;
        if (!tools.isRoomSafe(roomName)) continue;
        let controller = Game.rooms[roomName].controller;
        if (!controller || controller.owner || controller.reservation && controller.reservation.username != 'Zyzyzyryxy') continue;
        roomsToClaim.push({roomName: roomName, reservation: controller.reservation?controller.reservation.ticksToEnd:0});
    }
    if (roomsToClaim.length > 1) roomsToClaim.sort((a,b) => a.reservation - b.reservation);
    if (roomsToClaim.length > 0 && roomsToClaim[0].reservation < 3000) return roomsToClaim[0].roomName;
    return null;
}

let spawnClaimers = function(room, spawn) {
    let roomToClaim = findRoomToClaimFrom(room);
    if (!roomToClaim) return false;
    let body = [MOVE, MOVE, CLAIM, CLAIM];
    if (room.memory.config.maintainRooms[roomToClaim].addAttack) body = [ATTACK, MOVE, MOVE, MOVE, CLAIM, CLAIM];
    while (getBodyCost(body) + getBodyCost([CLAIM, MOVE]) <= room.energyCapacityAvailable && body.length < 8) {
        body = body.concat([CLAIM, MOVE]);
    }
    if (getBodyCost(body) <= room.energyCapacityAvailable) {
        let memory = roles.claimer.manager.createMemory('claimer', room.name, roomToClaim, false);
        let name = tools.getCreepName(memory);
        if (spawn.canCreateCreep(body, name) == 0) {
            spawn.createCreep(body, name, memory);
        } else {
            room.memory.spawnQueue.push({body: body, name: name, memory: memory});
        }
        return true;
    }
    return false;
}

let countUpgradesInRoom = function(roomName) {
    let creepCount = 0;
    let workCount = 0;

    for(let n in Game.creeps) {
        c = Game.creeps[n];
        if (c.memory.role == 'upgrader' && c.memory.homeRoom == roomName) {
            creepCount += 1;
            workCount += c.getActiveBodyparts(WORK);
        }
    }

    return {creepCount: creepCount, workCount: workCount };
}

let spawnUpgraders = function(room, spawner) {
    if (!('upgraders' in room.memory.config)) room.memory.config.upgraders = {spots: [], limitWork: CONTROLLER_MAX_UPGRADE_PER_TICK, limitCost: Infinity, minStoredEnergy: 100000, minSurplusEnergyPerWork: 10000};
    let conf = room.memory.config.upgraders;
    if (conf.limitWork > 15 && room.controller.level == 8) {
        conf.limitWork = 15;
        console.log(room+' upgrader work limit decreased to 15');
    }
    let stor = tools.getRoomStore(room);
    if (!stor) {
        return false;
    }
    if (!('lastUpdate' in conf) || conf.lastUpdate < Game.time - 100) {
        conf.storeId = stor.id;
        conf.nextBody = null;

        let counts = countUpgradesInRoom(room.name);
        conf.currentCount = counts.creepCount;
        conf.currentWork = counts.workCount;
        conf.lastUpdate = Game.time;
    }
    if (conf.limitWork <= conf.currentWork || conf.spots.length <= conf.currentCount || stor.store.energy < conf.minStoredEnergy) {
        return false;
    }

    let upgraderSize = roles.upgrader.manager.getBodySizeForLimits(room.energyCapacityAvailable, conf.limitWork - conf.currentWork);
    if (stor.store.energy < conf.minStoredEnergy + conf.minSurplusEnergyPerWork * (conf.currentWork + upgraderSize)) {
        return false;
    }

    let body = roles.upgrader.manager.getBodyForSize(upgraderSize);
    conf.nextBody = body;
    let memory = roles.upgrader.manager.createMemory('upgrader', room.name, null, 'upgrade');
    let name = tools.getCreepName(memory);
    if (spawner.canCreateCreep(body, name) == 0) {
        memory.workAt = conf.spots.shift();
        conf.spots.push(memory.workAt);
        spawner.createCreep(body, name, memory);
        conf.currentCount += 1;
        conf.currentWork += upgraderSize;
    }
    return true;

}

let runTowersAndSafeMode = function(room, spawns) {
    if (room.memory.minWallHeight == null) room.memory.minWallHeight = 40000;
    let minRampartHeight = room.memory.minWallHeight;
    let towers = towerControl.findTowers(room);

    let sumEnergyInTowers = 0;
    let isTowerDamaged = false;
    if (towers.length > 0 && 'dismantleStructures' in room.memory) {
        towerControl.exclude(room.memory.dismantleStructures);
    }
    for (let t = 0; t < towers.length; ++t) {
        sumEnergyInTowers += towers[t].energy;
        if (towers[t].hits < towers[t].hitsMax/2) isTowerDamaged = true;
        towers[t].energy == 0 ||
        towerControl.repair(towers[t], STRUCTURE_RAMPART, 301, true)  ||
        towerControl.repair(towers[t], STRUCTURE_TOWER, TOWER_HITS, true) ||
        towerControl.defend(towers[t]) ||
        towerControl.protectFromNuke(towers[t], minRampartHeight) ||
        towerControl.heal(towers[t]) ||
        towers[t].energy < towers[t].energyCapacity/2 ||
        Game.cpu.bucket < 1000 ||
        towerControl.repair(towers[t], STRUCTURE_RAMPART, minRampartHeight, false);
    }

    if (room.controller.level > 3 && !room.controller.safeMode &&
        (isTowerDamaged || (spawns[0].hits < spawns[0].hitsMax/2) || sumEnergyInTowers == 0) &&
        room.find(FIND_HOSTILE_CREEPS).length > 0) {
            room.controller.activateSafeMode();
    }
}

let buryTheDead = function() {
    if (Game.time%10 == 0) {
        for(let name in Memory.creeps) {
            if(!Game.creeps[name]) {
                delete Memory.creeps[name];
            }
        }
    }
}

let runCreeps = function() {
    let cpuUsage = {};
    for (let c in Game.creeps) {
        let role = Memory.creeps[c].role;
        if (role && role in roles) {
            let tmp = Game.cpu.getUsed();
            let creep = Game.creeps[c];
            try {
                if (!creep.spawning) roles[role].run(creep);
            } catch (e) {
                console.log(creep+' wih role '+role+' encountered error:');
                console.log(e);
                console.log(e.stack);
                Game.notify(e + '<BR/>'+ e.stack);
            }
            let creepTime = Game.cpu.getUsed()-tmp;
            if (!creep.spawning) {
                if (role in cpuUsage) {
                    cpuUsage[role].time += creepTime;
                    if (cpuUsage[role].timeMax < creepTime) cpuUsage[role].timeMax = creepTime;
                    cpuUsage[role].count += 1;
                } else {
                    cpuUsage[role] = {time: creepTime, count: 1, timeMax: creepTime};
                }
            }
        } else {
            console.log('Creep '+c+' has unknown role '+role);
        }
    }
    for (let r in cpuUsage) {
        let avgPerCreep = cpuUsage[r].time/cpuUsage[r].count;
        if (Memory.creepsCpuUsage == null) Memory.creepsCpuUsage = {};
        if (r in Memory.creepsCpuUsage) {
            Memory.creepsCpuUsage[r].avgPerCreep = Memory.creepsCpuUsage[r].avgPerCreep*0.95+avgPerCreep*0.05;
            Memory.creepsCpuUsage[r].max = Math.max(Memory.creepsCpuUsage[r].max, cpuUsage[r].timeMax);
            Memory.creepsCpuUsage[r].avgPerTick = Memory.creepsCpuUsage[r].avgPerTick*0.95+cpuUsage[r].time*0.05;
        } else {
            Memory.creepsCpuUsage[r] = {avgPerCreep: avgPerCreep, avgPerTick: cpuUsage[r].time, max: cpuUsage[r].timeMax};
        }
        if (Memory.displayPerformance) {
            console.log(r + ': total ' + Math.round(10*cpuUsage[r].time)/10 + ' on ' + cpuUsage[r].count + ' creeps, avg is ' + (Math.round(10*avgPerCreep)/10)+
                ', long term avg per creep is '+Math.round(100*Memory.creepsCpuUsage[r].avgPerCreep)/100+', long term avg per tick is '+Math.round(100*Memory.creepsCpuUsage[r].avgPerTick)/100+', max is '+(Math.round(10*cpuUsage[r].timeMax)/10));
        }
    }
}

let spawnRefillers = function(room, spawn) {
    if (!('refillers' in room.memory.config)) room.memory.config.refillers = {count: 1, maxSize: 4};
    if (!('count' in room.memory.config.refillers)) room.memory.config.refillers.count = 1;
    if (!('maxSize' in room.memory.config.refillers)) room.memory.config.refillers.maxSize = 4;
    refillersCount = _(Memory.creeps).filter({role: 'refiller', homeRoom: room.name}).size();
    if (refillersCount < room.memory.config.refillers.count) {
        let bodySize = Math.min(Math.floor(room.energyAvailable / 150), room.memory.config.refillers.maxSize);
        let body = [];
        for (let i = 0; i<bodySize; ++i) {
            body = body.concat([CARRY, CARRY, MOVE]);
        }
        let memory = { role: 'refiller', stage: 'find_source', homeRoom: room.name};
        let name = tools.getCreepName(memory);
        spawn.createCreep(body, name, memory);
        return true; //stop spawning others even if could not create refiller
    } else return false;
}

let spawnUrgentCreep = function(room, spawn) {
    if (!('spawnQueue' in room.memory)) {
        room.memory.spawnQueue = [];
    }
    if (room.memory.spawnQueue.length > 0) {
        let nextSpawn = room.memory.spawnQueue[0];
        let name = nextSpawn.name;
        if (!name) name = tools.getCreepName(nextSpawn.memory);
        let canCreate = spawn.canCreateCreep(nextSpawn.body, name);
        if (canCreate == 0) {
            spawn.createCreep(nextSpawn.body, name, nextSpawn.memory);
            room.memory.spawnQueue.shift();
        } else if (canCreate != ERR_NOT_ENOUGH_ENERGY) {
            console.log(room+' cant spawn from queue: '+canCreate);
        }
        return true;
    }
    return false;
}

let spawnGatherer = function(room, spawn) {
    let extractors = room.find(FIND_MY_STRUCTURES, {filter: {structureType: STRUCTURE_EXTRACTOR}});
    if (extractors.length > 0 && room.memory.mineral.id && Game.getObjectById(room.memory.mineral.id).mineralAmount > 0 && tools.countCreepsFromRoom('gatherer', room.name) == 0) {
        let body = tools.createBodyRepeat([], [MOVE, WORK, WORK], [WORK, MOVE, MOVE, CARRY, CARRY, CARRY], room.energyCapacityAvailable);
        if (!body) return false;
        if (spawn.canCreateCreep(body, 'Gatherer'+room.name)) {
            spawn.createCreep(body, 'Gatherer'+room.name, {role: 'gatherer', homeRoom: room.name});
        } else {
            room.memory.spawnQueue.push({body: body, name: 'Gatherer'+room.name, memory: {role: 'gatherer', homeRoom: room.name}});
        }
        return true;
    }
    return false;
}

let manageRoom = function(room, spawn) {
    if (!('config' in room.memory)) room.memory.config = {};
    if (!('mineral' in room.memory)) {
        let minerals = room.find(FIND_MINERALS);
        if (minerals.length > 0) {
            room.memory.mineral = {type: minerals[0].mineralType, id: minerals[0].id};
        } else {
            room.memory.mineral = {type: null, id: null};
        }
    }

//    console.log(room+spawn);
    let timeToNuke = room.find(FIND_NUKES).reduce(function(t,n) {if (n.timeToLand<t) return n.timeToLand; else return t; }, 5000);
    spawn.spawning ||
    room.energyAvailable < 300 ||
    spawnRefillers(room, spawn) ||
    timeToNuke < 1600 ||
    spawnUrgentCreep(room, spawn) ||
    spawnUpgraders(room, spawn) ||
    Game.cpu.bucket < 5000 ||
    spawnGatherer(room, spawn) ||
    spawnDrones(room, spawn) ||
    spawnMiners(room, spawn) ||
    spawnTransports(room, spawn) ||
    spawnClaimers(room, spawn) ||
    spawnRemoteDrones(room, spawn);

    terminalControl.manageSurplusResources(room);
}

let refreshRoomStatus = function() {
    let roomName;
    let attackedRooms = [];
    try {
        for (roomName in Game.rooms) {
            // find all visible rooms without status, init status to 'safe'
            if (!(roomName in Memory.rooms)) {
                Memory.rooms[roomName] = {};
            }
            if (!('status' in Memory.rooms[roomName])) {
                Memory.rooms[roomName].status = {safe: true, hostileCreepsSeen: {}};
            }
            let prevSafe = Memory.rooms[roomName].status.safe;
            // find all hostile creeps, update rooms to not safe
            // reset status for visible rooms without hostile creeps
            let hostiles = Game.rooms[roomName].find(FIND_HOSTILE_CREEPS, {filter: (h) => h.getActiveBodyparts(ATTACK) > 0 || h.getActiveBodyparts(RANGED_ATTACK) > 0});
            if (hostiles.length > 0) {
                hostiles = Game.rooms[roomName].find(FIND_HOSTILE_CREEPS);
            }
            Memory.rooms[roomName].status.safe = (hostiles.length == 0) || (Game.rooms[roomName].controller && Game.rooms[roomName].controller.my && Game.rooms[roomName].controller.safeMode>0);
    //        console.log(roomName+' is safe? '+Memory.rooms[roomName].status.safe+', '+Game.rooms[roomName].controller);
            Memory.rooms[roomName].civiliansAllowed = Game.rooms[roomName].controller && Game.rooms[roomName].controller.my || Memory.rooms[roomName].status.safe;
            // store hostile creeps in room status (id -> owner, tick when he dies)
            Memory.rooms[roomName].status.hostileCreepsSeen = {};
            for (let i in hostiles) {
                let hostile = hostiles[i];
                Memory.rooms[roomName].status.hostileCreepsSeen[hostile.id] = {owner: hostile.owner.username, livesTo: Game.time + hostile.ticksToLive};
            }
            if (!Memory.rooms[roomName].status.safe && isMyRoom(Game.rooms[roomName]) && prevSafe) {
                roles.guard.manager.setupRoomDefence(Game.rooms[roomName], hostiles);
            }
        }
        for (roomName in Memory.rooms) {
            if (roomName in Game.rooms) continue; // visible - already updated above
            if (!('status' in Memory.rooms[roomName])) continue; // rooms without status, never before visible - not handling them here. Might eventually contain some other data in the future?
            let status = Memory.rooms[roomName].status;
            if (status.safe) continue;

            let hostilesToDelete = [];
            for (let hId in status.hostileCreepsSeen) {
                // reset status for invisible rooms if last known invader timed out
                if (status.hostileCreepsSeen[hId].livesTo < Game.time) {
                    hostilesToDelete.push(hId);
                } else {
                    // reset status for invisible rooms if last known hostile player creep was seen elsewhere
                    //console.log('Looking for enemy with id '+hId);
                    let hostileCreep = Game.getObjectById(hId);
                    if (hostileCreep && hostileCreep.room.name != roomName) hostilesToDelete.push(hId);
                    // reset status for invisible rooms if last known hostile player creep was seen below some time limit? Send scout first?
                }
            }
            for (let i in hostilesToDelete) delete status.hostileCreepsSeen[hostilesToDelete[i]];
            status.safe = _(status.hostileCreepsSeen).size() == 0;
            Memory.rooms[roomName].civiliansAllowed = Memory.rooms[roomName].status.safe;
        }
    } catch (e) {
        console.log('Error during refreshRoomStatus:'+e);
        console.log(e.stack);
        Game.notify('Error during refreshRoomStatus:<BR/>'+e + '<BR/>' + e.stack);
    }
}

let isMyRoom = function(room) {
    return room && room.controller && (room.controller.my || !room.controller.owner && room.controller.reservation && room.controller.reservation.username == 'Zyzyzyryxy');
}

let visualizeRoomStatus = function() {
    for (roomName in Game.rooms) {
        let room = Game.rooms[roomName];
        let vis = room.visual;
        let y = 1;
        vis.text(roomName, 1, y, {color: Memory.rooms[roomName].status.safe?'#00ff00':'#ff0000'});
        vis.text(room.controller?
                    room.controller.my?
                        'Level: '+room.controller.level+' store: '+(room.storage?
                                                                        room.storage.store.energy
                                                                        :'no storage')
                        :room.controller.reservation?
                            'reserved by '+room.controller.reservation.username+' for '+room.controller.reservation.ticksToEnd
                            :'not reserved'
                    :'no controller',
                3, y, {align: 'left'});
        ++y;
        let roomSpawns = room.find(FIND_MY_SPAWNS);
        for (let i in roomSpawns) {
            let spawn = roomSpawns[i];
            let spawnName = spawn.name;
            if (spawn.spawning) {
                let creep = Game.creeps[spawn.spawning.name];
                let role = Memory.creeps[spawn.spawning.name].role;
                vis.text(spawnName+' spawning '+role+' to '+roles[role].describeTarget(creep), 1, y, {align: 'left', color: '#ffff00'});
            } else {
                vis.text(spawnName+' idle', 1, y, {align: 'left', color: '#00ffff'});
            }
            ++y;
        }
    }
}

let markDismantle = function() {
    for (let r in Game.rooms) {
        let vis = Game.rooms[r].visual;
        let roomMemory = Memory.rooms[r];
        vis.text('Target wall height: '+roomMemory.minWallHeight, 40, 2);
        if (!('dismantleStructures' in Memory.rooms[r])) continue;
        let configuredStructs = roomMemory.dismantleStructures;
        let existingStructs = [];
        for (let d = configuredStructs.length; d >= 0; --d) {
            let disObj = Game.getObjectById(configuredStructs[d]);
            if (disObj) {
                disObj.notifyWhenAttacked(false);
                existingStructs.push(disObj.id);
                vis.circle(disObj.pos, {fill: '#ff0000'});
            }
        }
        Memory.rooms[r].dismantleStructures = existingStructs;
    }
}

let chooseSpawn = function(spawnsInRoom) {
    if (spawnsInRoom.length == 1) return spawnsInRoom[0];
    let i = 0;
    while ((i < spawnsInRoom.length - 1) && spawnsInRoom[i].spawning) ++i;
    return spawnsInRoom[i];
}

spawnScientistIfNeeded = function(room, lab1, lab2, fullOutputLabs) {
    if (!room.terminal) return;
    let scientistsCount = _(Memory.creeps).filter({role: 'scientist', homeRoom: room.name}).size();
    let plannedCount = _(room.memory.spawnQueue).filter({memory: {role: 'scientist'}}).size();
//    console.log(room+' has '+scientistsCount+' scientists and '+plannedCount+' planned');
    if (scientistsCount + plannedCount > 0) return;
    let reaction = room.memory.config.labs.react;
    if ((room.terminal.store[reaction.reagent1] > 0 && lab1.mineralAmount < LAB_REACTION_AMOUNT) ||
        (room.terminal.store[reaction.reagent2] > 0 && lab2.mineralAmount < LAB_REACTION_AMOUNT)) {
            console.log('Spawning scientist because input available in '+room);
            scientist.planSpawn(room);
    } else {
        let productAmount = reaction.use.reduce((prev, labId) => prev + Game.getObjectById(labId).mineralAmount, 0);
        if (productAmount > 0) {
            console.log('Spawning scientist because output full in '+room);
            scientist.planSpawn(room); //TODO: adjust size to amount?
        }
    }
}

runReactions = function(room) {
    if (!('labs' in room.memory.config) || !room.memory.config.labs.react || room.memory.config.labs.react.use.length == 0) return;
    let lab1 = Game.getObjectById(room.memory.config.labs.in1);
    let lab2 = Game.getObjectById(room.memory.config.labs.in2);
    if (!lab1 || !lab2) {
        console.log(room+' has wrong lab ids: '+room.memory.config.labs.in1+'/'+room.memory.config.labs.in2);
        return;
    }
    let useLabs = room.memory.config.labs.react.use;
    if (lab1.mineralAmount < LAB_REACTION_AMOUNT || lab2.mineralAmount < LAB_REACTION_AMOUNT) return spawnScientistIfNeeded(room, lab1, lab2);
    let useLabsCount = useLabs?useLabs.length:0;
    if (useLabsCount > 0) {
        let fullLabs = 0;
        for (let i = useLabsCount-1; i>=0; --i) {
            let lab = Game.getObjectById(useLabs[i]);
            if (lab.cooldown == 0) lab.runReaction(lab1, lab2);
            if (lab.mineralAmount == lab.mineralCapacity) {
                fullLabs++;
            }
        }
        if (fullLabs == useLabsCount) {
            spawnScientistIfNeeded(room, lab1, lab2);
        }
    }
}

let start;

function measure(stepName) {
    if (Memory.displayPerformance) {
        console.log(stepName+' took '+(Game.cpu.getUsed()-start));
        start = Game.cpu.getUsed();
    }
}

function benchmark(fn) {
    let args = Array.prototype.slice.call(arguments, 1);
    let startTime = Game.cpu.getUsed();
    let ret = fn.apply(null, args);
    console.log(fn.name+'('+args+') took '+(Game.cpu.getUsed()-startTime));
    return ret;
}
global.benchmark = benchmark;

function blackMagic(fn) {
    let memory;
    let tick;
    return () => {
        let start = Game.cpu.getUsed();
        //console.log('Start loop: '+start);
        if (tick && tick + 1 === Game.time && memory) {
            delete global.Memory;
            Memory = memory;
        } else {
            //console.log('Global was reset');
        }
        memory = Memory;
        tick = Game.time;
        //console.log('Parsing memory: '+(Game.cpu.getUsed()-start));
        fn();
        start = Game.cpu.getUsed();
        RawMemory._parsed = Memory;
        //console.log('Saving memory: '+(Game.cpu.getUsed()-start));
        //console.log('All: '+Game.cpu.getUsed());
    };
}

module.exports.loop = blackMagic(function () {
    start = 0;
    measure('pre-loop');
    try {
        roles.refiller.manager.init();
        roles.drone.manager.init();
        roles.remoteDrone.manager.init();
        measure('init');
        buryTheDead();
        measure('bury dead');
        refreshRoomStatus();
        visualizeRoomStatus();
        measure('room status');
        runCreeps();
        measure('run creeps');
        let roomsWithSpawns = tools.getRoomsAndSpawns();
        measure('map rooms');
        for(let r in roomsWithSpawns) {
            let room = roomsWithSpawns[r].room;
            let spawns = roomsWithSpawns[r].spawns;
            linkControl.run(room);
            runTowersAndSafeMode(room, spawns);
            manageRoom(room, chooseSpawn(spawns));
            runReactions(room);
            measure(room);
        }
        markDismantle();
        if (Game.cpu.bucket < 1000) {
            console.log('Warning! Bucket low! Remaining cpu: '+(Game.cpu.limit-Game.cpu.getUsed())+', bucket is '+Game.cpu.bucket);
        }
    } catch (e) {
        console.log('Error during loop:'+e);
        console.log(e.stack);
        Game.notify('Error during loop:<BR/>'+e + '<BR/>' + e.stack);
    }
    new RoomVisual().text(Game.cpu.bucket, 45, 1);
    if (Memory.futureSpawns != null && Memory.futureSpawns.length > 0 && Memory.futureSpawns[0].minTime <= Game.time) {
        let futureSpawn = Memory.futureSpawns.shift();
        Memory.rooms[futureSpawn.fromRoom].spawnQueue.push(futureSpawn);
    }
});
