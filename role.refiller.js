var reservedObjects = [];
var structsToFillInRooms = {};

var removeIfFound = function (targetsList, target) {
    if (!target) return false;
    var idx = targetsList.indexOf(target);
    if (idx == -1) return false;
    targetsList.splice(idx, 1);
    return true;
}

var assignIfFound = function (targetsList, target, creep) {
    if (removeIfFound(targetsList, target)) {
        creep.memory.targetId = target.id;
        return true;
    } else {
        return false;
    }
}

var findContainersToFill = function(room) {
    var positions = room.memory.config.refillers.fillContainers;
    var containers = [];
    for (var i in positions) {
        if ('pos' in positions[i]) {
            positions[i] = positions[i].pos;
            room.memory.config.refillers.fillContainers[i] = positions[i];
        }
        var pos = tools.loadPos(positions[i]);
        if (!pos) {
            console.log(JSON.stringify('Bad entry in fillContainers at room '+room+', i='+i+': '+positions[i].pos));
            continue;
        }
        var structsFound = pos.findInRange(FIND_STRUCTURES, 0, {filter: (s) => s.structureType==STRUCTURE_CONTAINER || s.structureType == STRUCTURE_LINK});
        if (structsFound.length > 0 ) {
            var struct = structsFound[0];
            if (struct.structureType == STRUCTURE_CONTAINER && _.sum(struct.store) < struct.storeCapacity ||
                struct.structureType == STRUCTURE_LINK && struct.energy < struct.energyCapacity) {
                containers.push(struct);
            }
        }
    }
    return containers;
}


var runner = {
    run: function(creep) {
        if (creep.spawning) return;
        var homeRoom = Game.rooms[creep.memory.homeRoom];
        var refillersConfig = homeRoom.memory.config.refillers;

        var mem = creep.memory;
        if (mem.stage == 'work' && creep.carry.energy == 0) {
            mem.stage = 'find_source';
            mem.targetId = null;
            creep.say('harvest');
        }
        if (mem.stage == 'find_source') {
            mem = this.initSource(creep, mem, refillersConfig);
        }
        if (mem.stage != 'work' && creep.carry.energy == creep.carryCapacity) {
            mem.stage = 'work';
            creep.say('work');
        }
        creep.memory = mem;

        switch (mem.stage) {
            case 'load':
                this.loadEnergy(creep, mem, refillersConfig);
                break;
            case 'work':
                this.work(creep, mem, refillersConfig);
                break;
        }
    },
    initSource: function(creep, mem, refillersConfig) {
        var structure = creep.pos.findClosestByPath(FIND_STRUCTURES, {
            filter: function(struct) {
                return (struct.structureType != STRUCTURE_TERMINAL && ('store' in struct) && struct.store[RESOURCE_ENERGY] >= creep.carryCapacity - creep.carry.energy &&
                    _(refillersConfig.fillContainers).filter(struct.pos).size() == 0 );
            }
        });
        if (!structure) {
            structure = creep.pos.findClosestByPath(FIND_STRUCTURES, {
                ignoreCreeps: true,
                filter: function(struct) {
                    return 'store' in struct && struct.store[RESOURCE_ENERGY] > 0;
                }
            });
        }
        if (structure) {
            mem.storeId = structure.id;
            mem.stage = 'load';
        } else {
            var drop = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {filter: {resourceType: RESOURCE_ENERGY}});
            if (drop) {
                if (creep.pos.isNearTo(drop)) creep.pickup(drop);
                else creep.moveTo(drop);
            } else {
                if (creep.carry.energy > 0) mem.stage = 'work';
                if (Game.time%20 == 0) console.log('Refiller '+creep.name+' did not find any source of energy in '+creep.room+'!');
            }
        }
        return mem;
    },
    loadEnergy: function(creep, mem) {
        var source = Game.getObjectById(mem.storeId);
        var energyToWithdraw = creep.carryCapacity - creep.carry.energy;
        energyToWithdraw -= tools.pickupNearbyEnergyDrops(creep);
        if (energyToWithdraw <= 0) {
            creep.memory.stage = 'work';
        } else {
            switch (creep.withdraw(source, RESOURCE_ENERGY, energyToWithdraw)) {
                case ERR_NOT_IN_RANGE:
                    creep.moveTo(source);
                    break;
                case OK:
                    creep.memory.stage = 'work';
                    break;
                case ERR_NOT_ENOUGH_RESOURCES:
                    creep.withdraw(source, RESOURCE_ENERGY);
                    creep.memory.stage = 'find_source';
                    break;
            }
        }
    },
    work: function(creep, mem, refillersConfig) {
        tools.pickupNearbyEnergyDrops(creep);

        if (mem.targetId) {
            target = Game.getObjectById(mem.targetId);
            if (!target ||
                ('energy' in target) && target.energy == target.energyCapacity ||
                ('store' in target) && _.sum(target.store) == target.storeCapacity) {
                    target = null;
                    mem.targetId = null;
                }
        }
        if (!target) {
            if (structsToFillInRooms[mem.homeRoom].primary.length > 0) {
                var target = creep.pos.findClosestByPath(structsToFillInRooms[mem.homeRoom].primary, {ignoreCreeps: true});
                assignIfFound(structsToFillInRooms[mem.homeRoom].primary, target, creep);
            } else if (structsToFillInRooms[mem.homeRoom].backup.length > 0) {
                var target = creep.pos.findClosestByPath(structsToFillInRooms[mem.homeRoom].backup, {ignoreCreeps: true});
                assignIfFound(structsToFillInRooms[mem.homeRoom].backup, target, creep);
                if (target) structsToFillInRooms[mem.homeRoom].backup.splice(structsToFillInRooms[mem.homeRoom].primary.indexOf(target), 1);
            }
        }
        if (target) {
//            console.log(creep+': room visual: '+creep.room.visual+', target: '+target);
            creep.room.visual.line(creep.pos, target.pos);
            creep.say('refill');
            var ret = creep.transfer(target, RESOURCE_ENERGY);
            switch (ret) {
                case ERR_NOT_IN_RANGE:
                    let mustWatchOut = creep.pos.inRangeTo(target, 3) || creep.room.storage !== undefined && creep.pos.inRangeTo(creep.room.storage, 3) || creep.room.terminal !== undefined && creep.pos.inRangeTo(creep.room.terminal, 3);
                    creep.moveTo(target, {reusePath: mustWatchOut?0:6, ignoreCreeps: !mustWatchOut});
                    var closeTargets = creep.pos.findInRange(structsToFillInRooms[mem.homeRoom].primary, 1);
                    if (closeTargets.length == 0) closeTargets = creep.pos.findInRange(structsToFillInRooms[mem.homeRoom].backup, 1);
                    if (closeTargets.length > 0) creep.transfer(closeTargets[0], RESOURCE_ENERGY);
                    break;
                case OK:
                case ERR_FULL:
                    mem.targetId = null;
                    break;
                default:
                    console.log('Refiller got '+ret);
            }
        } else {
            mem.stage = 'find_source';
        }
    },
    describeTarget: function(creep) {
        return 'room '+creep.memory.homeRoom;
    },
    manager: {
        createMemory: function(roleName, homeRoom) {
            return { role: roleName, stage: 'find_source', homeRoom: homeRoom};
        },
        markReservedObjects: function() {
            for (i in reservedObjects) {
                var obj = Game.getObjectById(reservedObjects[i]);
                obj.room.visual.circle(obj.pos, {radius: 1, fill: '#ff00ff'});
            }
        },
        init: function() {
            reservedObjects = [];
            structsToFillInRooms = {};
//            var startTime = Game.cpu.getUsed();
            var creepsInRooms = _(Game.creeps).filter(
                (c) => c.memory.role == 'refiller' && c.carry.energy > 0
            ).value().forEach((c) => {
                var homeRoomName = c.memory.homeRoom;
                if (!(homeRoomName in structsToFillInRooms)) {
                    var homeRoom = Game.rooms[homeRoomName];
                    if (!('refillers' in homeRoom.memory.config)) homeRoom.memory.config.refillers = {count: 1};
                    if (!('fillContainers' in homeRoom.memory.config.refillers)) homeRoom.memory.config.refillers.fillContainers = [];
                    if (!('terminalEnergyLimit' in homeRoom.memory.config.refillers)) homeRoom.memory.config.refillers.terminalEnergyLimit = 10000;
                    
                    structsToFillInRooms[homeRoomName] = {
                        backup: findContainersToFill(homeRoom),
                        primary: homeRoom.find(FIND_MY_STRUCTURES, {filter:
                            (s) => [STRUCTURE_SPAWN, STRUCTURE_EXTENSION, STRUCTURE_LAB].indexOf(s.structureType) != -1 && s.energy < s.energyCapacity ||
                                   s.structureType == STRUCTURE_TOWER && s.energy < (s.energyCapacity - 50) ||
                                   s.structureType == STRUCTURE_TERMINAL && (s.store.energy < homeRoom.memory.config.refillers.terminalEnergyLimit) &&
                                    homeRoom.storage != undefined && (homeRoom.storage.store.energy > s.store.energy)
                        })
                    };
                    removeIfFound(structsToFillInRooms[homeRoomName].primary, c.memory.targetId);
                    removeIfFound(structsToFillInRooms[homeRoomName].backup, c.memory.targetId);
                }
                
            });

//            console.log('Finding structs to fill took '+(Game.cpu.getUsed()-startTime) + ' for rooms: '+_(structsToFillInRooms).size());
        }
    }
}

module.exports = runner;
