var tools = require('util.tools');

var runner = {
    run: function(creep) {
        if (creep.spawning) return;
        var mem = creep.memory;
        
        if (mem.stage != 'go' && !creep.pos.isEqualTo(new RoomPosition(mem.workAt.x, mem.workAt.y, mem.workAt.roomName))) {
            mem.stage = 'go';
        }
        if (mem.stage == 'go') this.go(creep, mem);
        if (mem.stage == 'find_source') this.initSource(creep, mem);
        if (mem.stage == 'find_container') this.initContainer(creep, mem);
        if (mem.stage == 'build_container') this.buildContainer(creep, mem);
        if (mem.stage == 'work') this.work(creep, mem);
    },
    go: function(creep, mem) {
        if ('pos' in mem.workAt) mem.workAt = mem.workAt.pos;
        if (!Memory.rooms[mem.workAt.roomName].status.safe) {
            creep.say('Halp!');
            var escapePos = tools.getRoomRefugeesCampPos(creep.memory.homeRoom);
            return creep.moveTo(escapePos);
        }
        var dest = tools.loadPos(mem.workAt);
        if (creep.pos.isEqualTo(dest)) {
            mem.stage = 'find_source';
        } else {
            creep.moveTo(dest, {ignoreCreeps: true});
            if (creep.fatigue == 0 && creep.memory._move && creep.memory._move.path) {
                var path = Room.deserializePath(creep.memory._move.path);
                if (path && path.length > 0) {
                    var step = path[0];
                    var other = creep.room.lookForAt(LOOK_CREEPS, step.x, step.y);
                    if (other.length > 0) {
                        if (other[0].memory && other[0].memory.role == 'miner') {
                            if (dest.isEqualTo(tools.loadPos(other[0].memory.workAt))) {
                                if (other[0].ticksToLive < creep.ticksToLive) {
                                    other[0].suicide();
                                } else {
                                    creep.suicide();
                                }
                            } else {
                                other[0].memory.stage = 'go';
                                other[0].moveTo(creep);
                            }
                        } else {
                            other[0].moveTo(creep);
                        }
                    }
                }
            }
        }
        return mem;
    },
    initSource: function(creep, mem) {
        var source = creep.pos.findInRange(FIND_SOURCES, 1)[0];
        if (source) {
            mem.sourceId = source.id;
            mem.stage = 'find_container';
        } else {
            console.log('Miner '+creep.name+' did not find its source!');
            mem.stage = 'find_source';
        }
        return mem;
    },
    initContainer: function(creep, mem) {
        var containers = creep.pos.findInRange(FIND_STRUCTURES, 1, {filter: {structureType: STRUCTURE_CONTAINER}});
        if (containers.length) {
            mem.containerId = containers[0].id;
            mem.stage = 'work';
        } else {
            var constrSites = creep.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {filter: {structureType: STRUCTURE_CONTAINER}});
            if (constrSites.length) {
                mem.constructionSiteId = constrSites[0].id;
                mem.stage = 'build_container';
            } else {
                creep.pos.createConstructionSite(STRUCTURE_CONTAINER);
            }
        }
        return mem;
    },
    buildContainer: function(creep, mem) {
        tools.pickupNearbyEnergyDrops(creep);
        var source = Game.getObjectById(mem.sourceId);
        var site = Game.getObjectById(mem.constructionSiteId);
        if (site) {
            creep.harvest(source);
            if (creep.carry.energy >= creep.getActiveBodyparts(WORK) * 5) creep.build(site);
        } else {
            var containers = creep.pos.findInRange(FIND_STRUCTURES, 1, {filter: {structureType: STRUCTURE_CONTAINER}});
            if (containers.length) {
                mem.containerId = containers[0].id;
                mem.stage = 'work';
            } else {
                console.log('Miner '+creep.name+' lost its construction site');
                mem.stage = 'find_container';
            }
        }
        return mem;
    },
    work: function(creep, mem) {
        if (!creep.room.memory.civiliansAllowed) {
            mem.stage = 'go';
            creep.drop(RESOURCE_ENERGY);
            return mem;
        }
        var pickedUp = tools.pickupNearbyEnergyDrops(creep);
        var source = Game.getObjectById(mem.sourceId);
        var container = Game.getObjectById(mem.containerId);
        if (source && source.energy > 0) {
            creep.harvest(source);
            var energyAfterHarvest = creep.carry.energy + creep.getActiveBodyparts(WORK)*HARVEST_POWER + pickedUp;
            if (container && energyAfterHarvest > creep.carryCapacity) {
                creep.transfer(container, RESOURCE_ENERGY, creep.carry.energy);
            } else if (!container) {
                console.log('Miner '+creep.name+' lost its container');
                mem.stage = 'find_container';
            }
        } else if (container && container.hits < container.hitsMax) {
            if (creep.carry.energy > 0) {
                creep.repair(container);
            } else {
                creep.withdraw(container, RESOURCE_ENERGY);
            }
        }
        return mem;
    },
    describeTarget: function(creep) {
        return 'pos '+tools.loadPos(creep.memory.workAt);
    },
    manager: {
        createMemory: function(roleName, home, workAt) {
            return { role: roleName, homeRoom: home, home: home, workAt: workAt, stage: 'go'};
        },
        getBodyForCostLimit: function(maxCosts, maxWork) {
            if (!maxWork) maxWork = Infinity;
            var workCount = Math.min(Math.floor((maxCosts - 100)/100), maxWork);
            var remainingCost = maxCosts - 100*workCount - 50;
            var moveCount = Math.floor(Math.min(remainingCost/50, (workCount + 2)/2));
            return new Array(moveCount).fill(MOVE).concat(new Array(workCount).fill(WORK)).concat([CARRY]);
        }
    }
}

global.miner = {
    planSpawn: function(room, minePos, energyLimit) {
        if (!energyLimit || energyLimit <= 0|| energyLimit > room.energyCapacityAvailable) {
            energyLimit = room.energyCapacityAvailable;
        }
        var body = runner.manager.getBodyForCostLimit(energyLimit);
        var memory = runner.manager.createMemory('miner', room.name, minePos);
        let name = tools.getCreepName(memory);
        room.memory.spawnQueue.push({body: body, name: name, memory: memory});
        return JSON.stringify(room.memory.spawnQueue);
    }
}

module.exports = runner;
