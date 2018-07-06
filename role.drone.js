var handledObjects = [];
var markHandled = function(struct) {
    if (handledObjects.indexOf(struct.id) == -1) {
        handledObjects.push(struct.id);
    }
};

var findLowestWall = function(room) {
    var excluded = ('dismantleStructures' in room.memory)?room.memory.dismantleStructures : [];
    var walls = room.find(FIND_STRUCTURES, {filter: (s) => (s.structureType == STRUCTURE_WALL || s.structureType == STRUCTURE_RAMPART) && excluded.indexOf(s.id) == -1 && s.hits != null});
    if (walls.length == 0) return null;
    walls.sort((a,b) => a.hits - b.hits);
    room.memory.minWallHeight = Math.max(walls[0].hits, room.memory.minWallHeight);
    return walls[0].id;
}

var findSomethingToRepair = function(creep) {
        var structToRepair;
        if (structToRepair = tools.findDamagedStructure(creep.pos, STRUCTURE_SPAWN)) {
        } else if (structToRepair = tools.findDamagedStructure(creep.pos, STRUCTURE_EXTENSION)) {
        } else if (structToRepair = tools.findDamagedStructure(creep.pos, STRUCTURE_TOWER)) {
        } else if (structToRepair = tools.findDamagedStructure(creep.pos, STRUCTURE_STORAGE)) {
        } else if (structToRepair = tools.findDamagedStructure(creep.pos, STRUCTURE_CONTAINER)) {
        } else if (structToRepair = tools.findDamagedStructure(creep.pos, STRUCTURE_ROAD, handledObjects)) {
            markHandled(structToRepair);
        }
        return structToRepair;
}

var findWallToRepair = function(creep) {
    if (creep.memory.role == 'remoteDrone') return null;
    var excluded = ('dismantleStructures' in creep.room.memory)?creep.room.memory.dismantleStructures : [];
    var maxWallHeight = 40000;
    if ('minWallHeight' in creep.room.memory) maxWallHeight = creep.room.memory.minWallHeight;
    var wall = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: function(struct) {
            return (struct.structureType == STRUCTURE_WALL || struct.structureType == STRUCTURE_RAMPART) && struct.hits < maxWallHeight && excluded.indexOf(struct.id) == -1;
        }
    });
    if (wall && (wall.hitsMax <= wall.hits)) wall = null;
    if (wall) {
//        console.log(creep+' found wall at '+wall.pos+' to bee too low: '+wall.hits+'/'+maxWallHeight);
    } else {
//        console.log(creep+' did not find a wall needing maintenance');
        if ((creep.room.controller.level == 8) && creep.room.storage && (creep.room.storage.store.energy > 700000)) creep.room.memory.minWallHeight = maxWallHeight + 1000;
    }
    return wall;
}

var runner = {
    run: function(creep) {
        if (creep.spawning) return;
        var destRoom = creep.memory.targetRoom? creep.memory.targetRoom : creep.memory.homeRoom;
        if (Memory.rooms[destRoom] && Memory.rooms[destRoom].status && !Memory.rooms[destRoom].status.safe) {
            creep.say('Halp!');
            return creep.moveTo(tools.getRoomRefugeesCampPos(creep.memory.homeRoom));
        }

        var mem = creep.memory;
        if (creep.pos.roomName != destRoom && mem.stage != 'go_room' && mem.stage != 'go_supply') {
            mem.stage = 'go_room';
        }
        if (['go_room', 'dismantle', 'mine', 'load', 'find_source', 'go_supply'].indexOf(mem.stage) == -1 && creep.carry.energy == 0) {
            mem.stage = 'find_source';
            creep.say('harvest');
        }
        if (mem.stage == 'mine' && creep.carry.energy == 0 && Game.time % 50 == 0) mem.stage = 'find_source';
        if (mem.stage == 'go_room' && tools.isPositionInsideRoom(creep.pos, mem.targetRoom)) {
            mem.stage = creep.carry.energy > 0 ? 'find_work' : 'find_source';
        }
        if (mem.stage == 'find_source') {
            mem = this.initSource(creep, mem);
        }
        if (['dismantle', 'mine', 'load', 'find_source'].indexOf(mem.stage) != -1 && creep.carry.energy == creep.carryCapacity) {
            mem.stage = 'find_work';
            creep.say('work');
        }
        if (mem.stage == 'find_work') {
            this.findWork(creep, mem);
        }

        switch (mem.stage) {
            case 'mine':
                this.mine(creep, mem);
                break;
            case 'load':
                this.loadEnergy(creep, mem);
                break;
            case 'upgrade':
                this.getOffRoad(creep, mem);
                this.upgradeOnce(creep, mem);
                break;
            case 'repair':
                this.getOffRoad(creep, mem);
                this.repair(creep, mem);
                break;
            case 'build':
                this.getOffRoad(creep, mem);
                this.build(creep, mem);
                break;
            case 'go_room':
                this.goToTargetRoom(creep, mem);
                break;
            case 'find_work':
                this.getOffRoad(creep, mem);
                break;
            case 'dismantle':
                this.dismantleStruct(creep, mem);
                break;
            case 'go_supply':
                this.getEnergyFromHome(creep, mem);
                break;
        }
    },
    getEnergyFromHome: function(creep, mem) {
        var homeRoom = Game.rooms[mem.homeRoom];
        var stor = tools.getRoomStore(homeRoom);
        if (creep.pos.isNearTo(stor)) {
            creep.withdraw(stor, RESOURCE_ENERGY);
            mem.stage = 'go_room';
        } else {
            creep.moveTo(stor);
        }
    },
    dismantleStruct: function(creep, mem) {
        var target = Game.getObjectById(mem.dismantleId);
        tools.pickupNearbyEnergyDrops(creep);
        if (target) {
            if (creep.dismantle(target) == ERR_NOT_IN_RANGE) {
                creep.moveTo(target, {maxRooms: 1});
            }
        } else {
            var toRemove = creep.room.memory.dismantleStructures.indexOf(mem.dismantleId);
            if (toRemove >= 0) creep.room.memory.dismantleStructures.splice(toRemove, 1);
            mem.stage = 'find_work';
        }
    },
    getOffRoad: function(creep, mem) {
        if (creep.room.lookForAt(LOOK_STRUCTURES, creep.pos.x, creep.pos.y).length == 0) return;
        var groundAround = creep.room.lookForAtArea(LOOK_TERRAIN, Math.max(1, creep.pos.y-1), Math.max(1, creep.pos.x-1), Math.min(48, creep.pos.y+1), Math.min(48, creep.pos.x+1), true);
        var emptyGroundAround = _(groundAround).filter((t) => {return t.terrain == 'plain' && creep.room.lookForAt(LOOK_STRUCTURES, t.x, t.y).length == 0;}).value();
        if (emptyGroundAround.length > 0) creep.moveTo(emptyGroundAround[0].x, emptyGroundAround[0].y, {maxRooms: 1});
    },
    goToTargetRoom: function(creep, mem) {
        if (!mem.targetRoom) mem.targetRoom = mem.homeRoom;
        var targetRoom = Game.rooms[mem.targetRoom];
        var dest = (targetRoom && targetRoom.controller)?targetRoom.controller:new RoomPosition(25, 25, mem.targetRoom);
        var res = creep.moveTo(dest);
//        console.log(creep + ' going to ' + dest + ' result: ' + res);
        
    },
    initSource: function(creep, mem) {
        this.findStructToDismantle(creep, mem) ||
        this.findContainerWithEnergy(creep, mem) ||
        this.getRoomSource(creep, mem) ||
        this.findActiveSource(creep, mem) ||
        (mem.stage = 'go_supply');
        return mem;
    },
    findStructToDismantle: function(creep, mem) {
        if (creep.getActiveBodyparts(WORK) < 4) return false;
        try {
            if ('dismantleStructures' in creep.room.memory) {
                var ids = creep.room.memory.dismantleStructures;
                var targets = _(ids).map(Game.getObjectById).value();
                var structure = creep.pos.findClosestByPath(targets);
                if (structure) {
                    mem.dismantleId = structure.id;
                    mem.stage = 'dismantle';
                    return true;
                }
            }
        } catch(e) {
            return false;
        }
        return false;
    },
    findContainerWithEnergy: function(creep, mem) {
        var structure = creep.pos.findClosestByPath(FIND_STRUCTURES, {
            ignoreCreeps: true,
            filter: function(struct) {
                return ((struct.structureType != STRUCTURE_TERMINAL || !struct.my) && ('store' in struct) && struct.store[RESOURCE_ENERGY] >= creep.carryCapacity) ||
                    (struct.structureType == STRUCTURE_LINK && struct.energy >= creep.carryCapacity);
            }
        });
        if (structure) {
            mem.storeId = structure.id;
            mem.stage = 'load';
            return true;
        }
        return false;
    },
    getRoomSource: function(creep, mem) {
        if (('config' in creep.room.memory) && ('drones' in creep.room.memory.config) && ('useSource' in creep.room.memory.config.drones)) {
            mem.sourceId = creep.room.memory.config.drones.useSource;
            mem.stage = 'mine';
            return true;
        }
        return false;
    },
    findActiveSource: function(creep, mem) {
        if (creep.room.controller && creep.room.controller.owner && !creep.room.controller.my) return false;
        var source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE, {ignoreCreeps: true});
        if (source) {
            mem.sourceId = source.id;
            mem.stage = 'mine';
            return true;
        }
        return false;
    },
    loadEnergy: function(creep, mem) {
        var source = Game.getObjectById(mem.storeId);
        var energyToWithdraw = creep.carryCapacity - creep.carry.energy;
        energyToWithdraw -= tools.pickupNearbyEnergyDrops(creep);

        if (energyToWithdraw <= 0) {
            creep.memory.stage = 'find_work';
        } else {
            switch (creep.withdraw(source, RESOURCE_ENERGY)) {
                case ERR_NOT_IN_RANGE:
                    creep.moveTo(source, {maxRooms: 1});
                    break;
                case OK:
                    creep.memory.stage = 'find_work';
                    break;
                case ERR_NOT_ENOUGH_RESOURCES:
                    creep.memory.stage = 'find_source';
                    break;
            }
        }
    },
    mine: function(creep, mem) {
        tools.pickupNearbyEnergyDrops(creep);
        var source = Game.getObjectById(mem.sourceId);
        var ret = creep.harvest(source);
        switch (ret) {
            case ERR_NOT_IN_RANGE:
                var others = creep.pos.findInRange(FIND_MY_CREEPS, 1, {filter: (c) => c.carry.energy > 0 && ['miner', 'collector'].indexOf(c.memory.role) != -1});
                for (var o = others.length-1; o >=0; --o) {
                    others[o].transfer(creep, RESOURCE_ENERGY);
                }
                creep.moveTo(source, {maxRooms: 1, ignoreCreeps: (creep.pos.getRangeTo(source)>3)});
                break;
            case ERR_NOT_OWNER:
            case ERR_NOT_ENOUGH_RESOURCES:
                mem.stage = (creep.carry.energy>creep.carryCapacity/2)?'find_work':'find_source';
        }
    },
    findWork: function(creep, mem) {
        var target;
        var ctrl = creep.room.controller;
        if (ctrl && ctrl.my && (ctrl.ticksToDowngrade < CONTROLLER_DOWNGRADE[ctrl.level] - 80)) {
            mem.stage = 'upgrade';
        } else if (Game.cpu.bucket > 4000 && (target = findSomethingToRepair(creep))) {
            mem.stage = 'repair';
            mem.targetId = target.id;
        } else if (target = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES)) {
            mem.stage = 'build';
            mem.targetId = target.id;
        } else if (Game.cpu.bucket > 4000 && (target = findWallToRepair(creep))) {
            mem.stage = 'repair';
            mem.targetId = target.id;
        } else {
            if (ctrl && ctrl.my) {
                if (ctrl.level < 8) {
                    mem.stage = 'upgrade';
                } else {
                    mem.stage = 'repair';
                    mem.targetId = findLowestWall(creep.room);
                }
            } else {
                this.findStructToDismantle(creep, mem);
            }
        }
        creep.say(mem.stage);
    },
    upgradeOnce: function(creep, mem) {
        if (creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE) {
            creep.moveTo(creep.room.controller, {maxRooms: 1});
        } else {
            mem.stage = 'find_work';
        }
    },
    repair: function(creep, mem) {
        var target = Game.getObjectById(mem.targetId);
        tools.pickupNearbyEnergyDrops(creep);
        if (!target || !('structureType' in target) || target.hits >= target.hitsMax || target.hits == null) {
            var targets = creep.pos.findInRange(FIND_STRUCTURES, 3, {filter: (s) => s.structureType != STRUCTURE_WALL && s.structureType != STRUCTURE_RAMPART && s.hits < s.hitsMax});
            target = creep.pos.findClosestByRange(targets);
            if (target) mem.targetId = target.id;
            else mem.stage = 'find_work';
        }
        if (target) {
            if (creep.repair(target) == ERR_NOT_IN_RANGE) {
                creep.moveTo(target, {maxRooms: 1});
                var otherDamaged = creep.pos.findInRange(FIND_STRUCTURES, 3, {filter: (s) => s.structureType != STRUCTURE_WALL && s.structureType != STRUCTURE_RAMPART && s.hits < s.hitsMax});
                if (otherDamaged.length > 0) creep.repair(otherDamaged[0]);
            }
        }
    },
    build: function(creep, mem) {
        var target = Game.getObjectById(mem.targetId);
        tools.pickupNearbyEnergyDrops(creep);
        if (!target) {
            mem.stage = 'find_work';
        } else {
            if (creep.build(target) == ERR_NOT_IN_RANGE) {
                creep.moveTo(target, {maxRooms: 1});
            }
        }
    },
    describeTarget: function(creep) {
        if ('targetRoom' in creep.memory) {
            return 'room '+creep.memory.targetRoom;
        } else {
            return 'this room';
        }
    },
    manager: {
        createMemory: function(roleName, homeRoom, targetRoom) {
            if (targetRoom) {
                return { role: roleName, stage: 'go_supply', homeRoom: homeRoom, targetRoom: targetRoom};
            } else {
                return { role: roleName, stage: 'find_source', homeRoom: homeRoom};
            }
        },
        init: function() {
            handledObjects = [];
        }
    }
}

module.exports = runner;
