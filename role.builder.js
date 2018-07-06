const findRoadBody = function(energyCap) {
    // CARRY = MOVE = WORK, full speed at roads and when empty, half speed when full off road
    const unitCost = BODYPART_COST[WORK] + BODYPART_COST[CARRY] + BODYPART_COST[MOVE];
    const units = Math.min( Math.floor(energyCap / unitCost), 16);
    return tools.createBodyFromParts([{part: WORK, count: units}, {part: CARRY, count: units}, {part: MOVE, count: units}]);
}

const findOffroadBody = function(energyCap) {
    // CARRY = WORK, MOVE = CARRY+WORK, full speed everywhere except swamps
    const unitCost = BODYPART_COST[WORK] + BODYPART_COST[CARRY] + 2*BODYPART_COST[MOVE];
    const units = Math.min( Math.floor(energyCap / unitCost), 12);
    return tools.createBodyFromParts([{part: WORK, count: units}, {part: CARRY, count: units}, {part: MOVE, count: 2*units}]);
}

global.builder = {
    planSpawn: function(homeRoom, buildRoom, sourceRoom, options) {
        if (homeRoom == null) return "planSpawn(homeRoom, buildRoom, sourceRoom, options), options = {assumeRoads, sources}, sources in [container, harvest, drop, walls, structures]";
        // default options = {assumeRoads: false, sources: ['container', 'harvest']}
        /* possible sources: 
            - container: look for any building with store attribute and energy in it
            - (energyBuilding): look for any building with energy attribute (spawn, extension, lab?) and energy in it
            - harvest: harvest from nearest active source ignored for rooms claimed/reserved by other player!)
            - drop: look for drops
            - walls: look for walls and ramparts to dismantle
            - structures: look for any structure to dismantle (WARNING! don't use if sourceRoom == buildRoom!)
        */
        if (!Game.map.isRoomAvailable(homeRoom)) return homeRoom+' is not a room name';
        if (!Game.map.isRoomAvailable(buildRoom)) return buildRoom+' is not a room name';
        if (!Game.map.isRoomAvailable(sourceRoom)) return sourceRoom+' is not a room name';
        let room = Game.rooms[homeRoom];
        if (room == null) return 'Home room '+homeRoom+' not visible!';
        if (room.find(FIND_MY_SPAWNS).length == 0) return 'No spawn in home room!';
        let buildRoomMemory = Memory.rooms[buildRoom];
        if (buildRoomMemory == null || buildRoomMemory.buildQueue == null || buildRoomMemory.buildQueue.length == 0) return 'Target room '+buildRoom+' have no build orders!';
        
        let body = options.assumeRoads?findRoadBody(room.energyCapacityAvailable):findOffroadBody(room.energyCapacityAvailable);
        let memory = {role: 'builder', homeRoom: homeRoom, buildRoom: buildRoom, sourceRoom: sourceRoom, state: 'init'};
        memory.sourcePriorities = (options.sources && options.sources.length > 0) ? options.sources : ['container', 'harvest'];
        let name = tools.getCreepName(memory);

        room.memory.spawnQueue.push({body: body, name: name, memory: memory});
        return JSON.stringify(room.memory.spawnQueue);
    },
    addSite: function(roomName, id, type, pos) {
        if (roomName == null) return "addSite(roomName, id, type, pos)";
        if (!Game.map.isRoomAvailable(roomName)) return roomName+' is not a room name';
        if (Memory.rooms[roomName] == null) {
            Memory.rooms[roomName] = {};
        }
        if (Memory.rooms[roomName].buildQueue == null) {
            Memory.rooms[roomName].buildQueue = [];
        }
        Memory.rooms[roomName].buildQueue.push({pos: pos, csId: id, type: type});
    },
    changeRoom: function(creepName, sourceRoom, buildRoom) {
        if (!Game.map.isRoomAvailable(buildRoom)) return buildRoom+' is not a room name';
        if (!Game.map.isRoomAvailable(sourceRoom)) return sourceRoom+' is not a room name';
        let buildRoomMemory = Memory.rooms[buildRoom];
        if (buildRoomMemory == null || buildRoomMemory.buildQueue == null || buildRoomMemory.buildQueue.length == 0) return 'Target room '+buildRoom+' have no build orders!';
        let creep = Game.creeps[creepName];
        if (creep == null) return 'No creep with name '+creepName;
        if (creep.memory.role != 'builder') return 'Creep '+creepName+' is not a builder';
        creep.memory.buildRoom = buildRoom;
        creep.memory.sourceRoom = sourceRoom;
        if (creep.carry.energy > 0) {
            creep.memory.targetRoom = buildRoom;
        } else {
            creep.memory.targetRoom = sourceRoom;
        }
        creep.memory.state = 'go';
    }
}

const serialize = function(path) {
    let spath = [];
    if (path == -2) return [];
    for (let p in path) {
        spath.push(path[p].x+'_'+path[p].y);
    }
    return spath;
}

const deserialize = function(spath, roomName) {
    let path = [];
    if (spath != null) {
        for (let s in spath) {
            let parts = spath[s].split('_');
            path.push(new RoomPosition(parts[0], parts[1], roomName));
        }
    }
    return path;
}

const roomCallback = function(roomName) {
    let room = Game.rooms[roomName];
    if (!room) return;
    let costs = new PathFinder.CostMatrix;

    room.find(FIND_STRUCTURES).forEach(function(struct) {
        if (struct.structureType === STRUCTURE_ROAD) {
            costs.set(struct.pos.x, struct.pos.y, 1);
        } else if (struct.structureType !== STRUCTURE_CONTAINER && (struct.structureType != STRUCTURE_RAMPART || !struct.my)) {
            costs.set(struct.pos.x, struct.pos.y, 0xff);
        }
    });
    room.find(FIND_CONSTRUCTION_SITES).forEach(function(site) {
        costs.set(site.pos.x, site.pos.y, 0xff);
    });

    return costs;
}

const moveByPath = function(creep, serializedPath) {
    let room = creep.room;
    let path = deserialize(serializedPath, room.name);
    room.visual.poly(path);
    return creep.moveByPath(path);
}

const findPathForRange = function(pos, targetPos, range) {
    // return serialized path!
    let searchResult = PathFinder.search(pos, {pos: targetPos, range: range}, {maxRooms: 1, roomCallback: roomCallback});
    if (searchResult.incomplete) {
        console.log('Cannot find path from '+pos+' to '+range+' from '+targetPos);
    }
    return serialize(searchResult.path);
}

const findPathToNearestExit = function(pos, room, direction) {
    let exitPos = undefined;
    if (room.memory.preferredExits == null || room.memory.preferredExits[direction] == null) {
        exitPos = pos.findClosestByPath(direction, {ignoreCreeps: true});
    } else {
        exitPos = room.memory.preferredExits[direction];
    }
    return findPathForRange(pos, exitPos, 0);
}

const isStructureUnprotected = function(structure) {
    let structuresAtPos = structure.pos.lookFor(LOOK_STRUCTURES);
    for (let i = structuresAtPos.length - 1; i >= 0; --i) {
        if (structuresAtPos[i].structureType == STRUCTURE_RAMPART && !structuresAtPos[i].my) return false;
    }
    return true;
}

const hasEnergyInStore = function(structure) {
    return structure.store != null && structure.store.energy > 0 && (structure.my || isStructureUnprotected(structure));
}

const hasEnergyLoaded = function(structure) {
    return structure.energy > 0 && (structure.my || isStructureUnprotected(structure));
}

const isEnemyWall = function(structure) {
    return !(structure.my) && ([STRUCTURE_WALL, STRUCTURE_RAMPART].indexOf(structure.structureType) != -1);
}

const isEnemyStructure = function(structure) {
    return !(structure.my);
}

const findClosestStructureMatching = function(pos, checkFn) {
    return pos.findClosestByPath(FIND_STRUCTURES, {
        filter: checkFn,
        maxRooms: 1,
        costCallback: roomCallback,
         // I assume following options only prevents unnecessary operations, since I overwrite costMatrix anyways
        ignoreCreeps: true,
        ignoreDestructibleStructures: true,
        ignoreRoads: true
    });
}

const actions = {
    container: {
        //look for any building with store attribute and energy in it
        findClosestTarget: function(pos) {
            return findClosestStructureMatching(pos, hasEnergyInStore);
        },
        run: function(creep, target) {
            creep.withdraw(target, RESOURCE_ENERGY);
            return false; // either store gets emptied, or creep gets full. It might theoretically get transferred to too, but in that case another find will return it again
        }
    },
    energyBuilding: {
        //look for any building with energy attribute (spawn, extension, lab?) and energy in it
        findClosestTarget: function(pos) {
            return findClosestStructureMatching(pos, hasEnergyLoaded);
        },
        run: function(creep, target) {
            creep.withdraw(target);
            return false; // either store gets emptied, or creep gets full. It might theoretically get transferred to too, but in that case another find will return it again
        }
    },
    harvest: {
        //harvest from nearest active source, ignored for rooms claimed/reserved by other player!)
        findClosestTarget: function(pos) {
            return pos.findClosestByPath(FIND_SOURCES_ACTIVE, {
                maxRooms: 1,
                costCallback: roomCallback,
                 // I assume following options only prevents unnecessary operations, since I overwrite costMatrix anyways
                ignoreCreeps: true,
                ignoreDestructibleStructures: true,
                ignoreRoads: true
            });
        },
        run: function(creep, target) {
            if (target.energy > 0) {
                creep.harvest(target);
            }
            return target.energy > 0 || target.ticksToRegeneration == 1;
        }
    },
    drop: {
        //look for drops
        findClosestTarget: function(pos) {
            return pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
                filter: r => r.resourceType == RESOURCE_ENERGY && r.amount >= 3 * pos.getRangeTo(r),
                maxRooms: 1,
                costCallback: roomCallback,
                 // I assume following options only prevents unnecessary operations, since I overwrite costMatrix anyways
                ignoreCreeps: true,
                ignoreDestructibleStructures: true,
                ignoreRoads: true
            });
        },
        run: function(creep, target) {
            creep.pickup(target);
            return false; // either creep gets full or drop gets picked up in full - can't repeat either way
        }
    },
    walls: {
        //look for walls and ramparts to dismantle
        findClosestTarget: function(pos) {
            return findClosestStructureMatching(pos, isEnemyWall);
        },
        run: function(creep, target) {
            creep.dismantle(target);
            return true; //structure existence is checked elsewhere
        }
    },
    structures: {
        //look for any structure to dismantle (WARNING! don't use if sourceRoom == buildRoom!)
        findClosestTarget: function(pos) {
            return findClosestStructureMatching(pos, isEnemyStructure);
        },
        run: function(creep, target) {
            creep.dismantle(target);
            return true; //structure existence is checked elsewhere
        }
    }
}

const chooseSourceAction = function(pos, sourcePriorities) {
    //{action, id, path};
    for (let p = 0; p < sourcePriorities.length; ++p) {
        let target = actions[sourcePriorities[p]].findClosestTarget(pos);
        if (target != null) {
            let sourceAction = {action: sourcePriorities[p], id: target.id, path: findPathForRange(pos, target.pos, 1)};
            return sourceAction;
        }
    }
    return null;
}

const performSourceAction = function(creep, sourceAction) {
    // return true / false to indicate if action can be performed (next turn)
    let target = Game.getObjectById(sourceAction.id);
    if (target == null) return false;
    if (creep.pos.isNearTo(target)) {
        return actions[sourceAction.action].run(creep, target);
    } else {
        moveByPath(creep, sourceAction.path);
        return true;
    }
}

const findRoomPath = function(fromRoomName, toRoomName) {
    return Game.map.findRoute(fromRoomName, toRoomName, {
        routeCallback(roomName, fromRoomName) {
            if(Memory.roomsToAvoid.indexOf(roomName) != -1) {    // avoid this room
                return Infinity;
            }
            return 1;
        }
    });
}

const getBuildingAt = function(structureType, pos, optRoom) {
    let room = optRoom || Game.rooms[pos.roomName];
    let structures = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
    for (let i = structures.length - 1; i >= 0; --i) {
        if (structures[i].structureType == structureType) return structures[i];
    }
    return null;
}

const getConstructionSitesAt = function(structureType, pos, optRoom) {
    let room = optRoom || Game.rooms[pos.roomName];
    let sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y);
    return sites[0];
}

const getNextBuildSite = function(room) {
    // example build order: {pos:{x:43,y:22,roomName:"E2S92"},csId:"59ca570e888c331b0fa78906",type:"spawn"}
    // shift through all sites that already are built (there is a structure of specified type in place)
    // for first not built, create site if necessary, return if it exists (site, not id!)
    // fill pos and type if empty but id in place and site exists, to be able to rebuild it in case it gets destroyed
    let site = undefined;
    let buildOrder = undefined;
    while (room.memory.buildQueue.length > 0) {
        buildOrder = room.memory.buildQueue[0];
        site = Game.getObjectById(buildOrder.csId);
        if (site) break;
        buildOrder.csId = null;
        if (buildOrder.pos != null && buildOrder.type != null) {
            if (getBuildingAt(buildOrder.type, buildOrder.pos, room) == null) {
                site = getConstructionSitesAt(buildOrder.type, buildOrder.pos, room);
                if (site == null) room.createConstructionSite(tools.loadPos(buildOrder.pos), buildOrder.type);
                else buildOrder.csId = site.id;
                break;
            }
        }
        room.memory.buildQueue.shift();
    }
    if (site && site.my) {
        if (buildOrder.pos == null) {
            buildOrder.pos = site.pos;
        }
        if (buildOrder.type == null) {
            buildOrder.type = site.structureType;
        }
    }
    return site;
}

/*
  init -> go(sourceRoom) -> getEnergy -> go(buildRoom) -> build -> go(sourceRoom) -> ...
  init: set targetRoom = sourceRoom, change state
  go: - if on the edge, move in and clear pos.
      - else if has pos - moveTo
      - else if room = sourceRoom or buildRoom, switch state
      - else if has roomPath, find next pos and moveTo
      - else find roomPath for targetRoom, then as above
  getEnergy: - if full, clear action and target, set targetRoom = buildRoom and switch to go
             - if no action and target stored, go through priorities, find action to perform and target
             - perform action on target
  build: - if empty, clear target, set targetRoom = sourceRoom and switch to go
         - if no target or target not exists, get target from list
         - build target
*/
const states = {
    init: function(creep) {
        //set targetRoom = sourceRoom, change state to go
        creep.memory.targetRoom = creep.memory.sourceRoom;
        creep.memory.state = 'go';
        return this.go(creep);
    },
    go: function(creep) {
        //- if on the edge, move in and clear pos.
        if (creep.pos.x == 0) {
            creep.move(RIGHT);
            creep.memory.pos = undefined;
        } else if (creep.pos.x == 49) {
            creep.move(LEFT);
            creep.memory.pos = undefined;
        } else if (creep.pos.y == 0) {
            creep.move(BOTTOM);
            creep.memory.pos = undefined;
        } else if (creep.pos.y == 49) {
            creep.move(TOP);
            creep.memory.pos = undefined;
        } else {
            //- else if has pos - moveTo
            //- else if room = targetRoom, switch state
            //- else if has roomPath, find next pos and moveTo
            //- else find roomPath for targetRoom, then as above
            if (creep.memory.pos == null) {
                creep.memory.path = undefined;
                if (creep.room.name == creep.memory.targetRoom) {
                    creep.memory.roomPath = undefined;
                    creep.memory.path = undefined;
                    creep.memory.pos = undefined;
                    if (creep.carry.energy == 0) {
                        creep.memory.state = 'getEnergy';
                        return this.getEnergy(creep);
                    } else {
                        creep.memory.state = 'build';
                        return this.build(creep);
                    }
                }
                if (creep.memory.roomPath == null) {
                    creep.memory.roomPath = findRoomPath(creep.room.name, creep.memory.targetRoom);
                }
                if (creep.memory.path == null && creep.memory.roomPath.length > 0) {
                    if (creep.room.name == creep.memory.roomPath[0].room) {
                        creep.memory.roomPath.shift();
                    }
                    creep.memory.path = findPathToNearestExit(creep.pos, creep.room, creep.memory.roomPath[0].exit);
                }
                moveByPath(creep, creep.memory.path);
            }
        }
    },
    getEnergy: function(creep) {
        //- if full, clear action and target, set targetRoom = buildRoom and switch to go
        if (_.sum(creep.carry) == creep.carryCapacity) {
            creep.memory.sourceAction = undefined;
            creep.memory.targetRoom = creep.memory.buildRoom;
            creep.memory.state = 'go';
            return this.go(creep);
        }
        //- if no action and target stored, go through priorities, find action to perform and target
        if (creep.memory.sourceAction == null) {
            creep.memory.sourceAction = chooseSourceAction(creep.pos, creep.memory.sourcePriorities);
        console.log(creep+' found source: '+JSON.stringify(creep.memory.sourceAction));
        }
        //- perform action on target
        if (creep.memory.sourceAction != null) {
            if (!performSourceAction(creep, creep.memory.sourceAction)) {
                creep.memory.sourceAction = undefined; // either just filled, or need to find next target / action next turn
            }
        } else {
            console.log(creep+' found no energy in room '+creep.room);
        }
    },
    build: function(creep) {
        //- if empty, clear target, set targetRoom = sourceRoom and switch to go
        if (creep.carry.energy == 0) {
            creep.memory.siteId = undefined;
            creep.pathToSite = undefined;
            creep.memory.targetRoom = creep.memory.sourceRoom;
            creep.memory.state = 'go';
            return this.go(creep);
        }
        //- if no target or target not exists, get target from list
        let site = Game.getObjectById(creep.memory.siteId);
        if (site == null) {
            site = getNextBuildSite(creep.room);
            if (site == null) {
                console.log(creep+' has nothing to build in '+creep.room);
                return;
            }
            creep.memory.siteId = site.id;
            if (!creep.pos.inRangeTo(site, 3)) {
                creep.memory.pathToSite = findPathForRange(creep.pos, site.pos, 3);
            }
        }
        //- build target
        if (creep.pos.inRangeTo(site, 3)) {
            creep.build(site);
        } else {
            moveByPath(creep, creep.memory.pathToSite);
        }
    }
}

module.exports = {
    run: function(creep) {
        if (creep.carryCapacity == 0) {
            // wait for healing?
            return ERR_NO_BODYPART;
        }
        return states[creep.memory.state](creep);
    },
    describeTarget: function(creep) {
        return 'room '+creep.memory.buildRoom;
    }
};