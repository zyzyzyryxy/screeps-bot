var findUnloadTarget = function(room, pos) {
    if (room.storage) return room.storage;
    if (room.terminal) return room.terminal;
    let containers = room.find(FIND_STRUCTURES, {filter: {structureType: STRUCTURE_CONTAINER}});
    if (containers.length == 0) return undefined;
    return pos.findClosestByPath(containers);
}

var findContainerAt = function(room, pos) {
    var containers = _(room.lookForAt(LOOK_STRUCTURES, pos)).filter(
        (s) => s.structureType != STRUCTURE_RAMPART && s.structureType != STRUCTURE_ROAD
        ).value();
    var container;
    if (containers.length > 0) {
        var hasHostileRampart = _(room.lookForAt(LOOK_STRUCTURES, pos)).filter({structureType: STRUCTURE_RAMPART, my: false}).size();
        if (hasHostileRampart == 0) return containers[0];
    }
    return null;
}

var adaptiveMoveTo = function(creep, targetPos) {
    if (creep.pos.inRangeTo(targetPos, 5) ||
        creep.room.storage && creep.pos.inRangeTo(creep.room.storage.pos, 3) ||
        creep.room.terminal && creep.pos.inRangeTo(creep.room.terminal.pos, 3)) {
        creep.moveTo(targetPos, {reusePath: 0});
    } else {
        creep.moveTo(targetPos, {reusePath: 40, ignoreCreeps: true});
    }
}

var controller = {
    checkStage: {
        load: function(creep) {
            var sumCarry = _.sum(creep.carry);
            if (sumCarry == creep.carryCapacity || sumCarry > creep.carryCapacity*0.8 && creep.room.name == creep.memory.homeRoom) {
                creep.memory.tmpUnloadAt = creep.memory.unloadAt;
                return 'unload';
            }
        },
        unload: function(creep) {
            var sumCarry = _.sum(creep.carry);
            if (sumCarry == 0) {
                return 'load';
            }
        },
        suicide: function(creep) {
        }
    },
    run: {
        load: function(creep) {
            var targetPos = tools.loadPos(creep.memory.loadAt);
            if (creep.pos.isNearTo(targetPos)) {
                var container = findContainerAt(creep.room, targetPos);
                if (!container) {
                    container = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, {filter: 
                        (s) => (('energy' in s) && s.energy > 0 && s.structureType != STRUCTURE_NUKER || ('store' in s) && _.sum(s.store) > 0) &&
                            _(s.pos.lookFor(LOOK_STRUCTURES)).filter({structureType: STRUCTURE_RAMPART, my: false}).size() == 0
                        });
                    if (!container) {
                        container = creep.pos.findClosestByPath(FIND_STRUCTURES, {filter: 
                            (s) => s.structureType == STRUCTURE_CONTAINER && _.sum(s.store) > 0
                            });
                    }
                    if (container) {
                        creep.memory.loadAt = container.pos;
                    } else {
                        var drop = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES);
                        if (drop) {
                            creep.memory.loadAt = drop.pos;
                            if (creep.pos.isNearTo(drop)) creep.pickup(drop);
                            else creep.moveTo(drop);
                        }
                    }
                }
                if (container) {
                    if (creep.withdraw(container, creep.memory.priorityResource) == ERR_NOT_ENOUGH_RESOURCES) {
                        var altResource = null;
                        for (altResource in container.store) {
                            if (container.store[altResource] > 0) {
                                break;
                            }
                        }
                        creep.withdraw(container, altResource);
                    }
                }
            } else {
                adaptiveMoveTo(creep, targetPos);
            }
        },
        unload: function(creep) {
            if ('pos' in creep.memory.tmpUnloadAt) creep.memory.tmpUnloadAt = creep.memory.tmpUnloadAt.pos;
            var targetPos = tools.loadPos(creep.memory.tmpUnloadAt);
            if (creep.pos.isNearTo(targetPos)) {
                var container = findContainerAt(creep.room, targetPos);
                if (container == undefined ||
                    ('energy' in container) && container.energy == container.energyCapacity ||
                    ('store' in container) && _.sum(container.store) == container.storeCapacity) {
                    container = findUnloadTarget(creep.room, creep.pos);
                    if (container) {
                        creep.memory.tmpUnloadAt = container.pos;
                        creep.moveTo(container);
                    } else {
                        creep.moveTo(tools.getRoomRefugeesCampPos(creep.room.name));
                    }
                } else {
                    var res = creep.memory.priorityResource;
                    if (creep.carry[res] == 0) {
                        for (res in creep.carry) {
                            if (creep.carry[res] > 0) {
                                break;
                            }
                        }
                    }
                    creep.transfer(container, res);
                }
            } else {
                adaptiveMoveTo(creep, targetPos);
            }
        },
        suicide: function(creep) {
            var spawn = Game.rooms[creep.memory.homeRoom].find(FIND_MY_SPAWNS)[0];
            if (creep.room.name == creep.memory.homeRoom) {
                var containers = spawn.pos.findInRange(FIND_STRUCTURES, 1, {filter: {structureType: STRUCTURE_CONTAINER}});
                if (containers.length > 0) {
                    if (creep.pos.isEqualTo(containers[0].pos)) {
                        spawn.recycleCreep(creep);
                    } else {
                        creep.moveTo(containers[0]);
                    }
                }
            } else {
                creep.moveTo(spawn, {reusePath: 40, ignoreCreeps: true});
            }
        }
    }
}

global.collector = {
    manager: {
        doSpawn: function(room, spawn, loadPos, unloadPos, resource, carrySize, movesSize) {
            var energyNeed = carrySize * BODYPART_COST[CARRY] + movesSize * BODYPART_COST[MOVE];
            if (room.energyCapacityAvailable < energyNeed ||
                carrySize + movesSize > MAX_CREEP_SIZE) {
                console.log('Cannot create transport with size '+carrySize+'C/'+movesSize+'M in room '+room);
                return;
            }
            var body = this.buildBody(carrySize, movesSize);
            var memory = this.prepareMemory(room.name, loadPos, unloadPos, resource);
            let name = tools.getCreepName(memory);
            if (spawn.canCreateCreep(body, name) == 0) {
                spawn.createCreep(body, name, memory);
            } else {
                room.memory.spawnQueue.push({body: body, name: name, memory: memory});
            }
        },
        planSpawn: function(room, loadPos, unloadPos, resource, carrySize, movesSize) {
            if (room.energyCapacityAvailable < carrySize * BODYPART_COST[CARRY] + movesSize * BODYPART_COST[MOVE] ||
                carrySize + movesSize > MAX_CREEP_SIZE) {
                console.log('Cannot create transport with size '+carrySize+'C/'+movesSize+'M in room '+room);
                return;
            }
            var body = this.buildBody(carrySize, movesSize);
            var memory = this.prepareMemory(room.name, loadPos, unloadPos, resource);
            let name = tools.getCreepName(memory);
            room.memory.spawnQueue.push({body: body, name: name, memory: memory});
            return JSON.stringify(room.memory.spawnQueue);
        },
        buildBody: function(carrySize, movesSize) {
            return tools.createBodyFromParts([{part: CARRY, count: carrySize}, {part: MOVE, count: movesSize}]);
        },
        prepareMemory: function(homeRoomName, loadPos, unloadPos, resource) {
            return {role: 'collector2', homeRoom: homeRoomName, loadAt: loadPos, unloadAt: unloadPos, priorityResource: resource, stage: 'load'};
        }
    }
}

module.exports = {
    run: function(creep) {
        if ('pos' in creep.memory.loadAt) creep.memory.loadAt = creep.memory.loadAt.pos;
        if ('pos' in creep.memory.unloadAt) creep.memory.unloadAt = creep.memory.unloadAt.pos;
        var stage = controller.checkStage[creep.memory.stage](creep);
        if (stage == undefined) stage = creep.memory.stage;
        if ((stage in controller.checkStage) && (stage in controller.run)) {
            creep.memory.stage = stage;
            controller.run[creep.memory.stage](creep);
        } else {
            console.log(creep+' tried to switch to invalid stage '+stage);
            Game.notify(creep+' tried to switch to invalid stage '+stage);
        }
    },
    describeTarget: function(creep) {
        return 'load from '+tools.loadPos(creep.memory.loadAt);
        
    },
    manager: global.manager
};
