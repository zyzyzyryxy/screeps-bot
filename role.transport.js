var actions = {
    goRoom: function(creep, destRoomName, positionsListName, creepAction) {
        if (tools.isPositionInsideRoom(creep.pos, destRoomName)) {
            creep.memory.action = 'selectContainer';
            return this.selectContainer(creep, destRoomName, positionsListName, creepAction);
        }
        var target;
        if (creep.room.name != destRoomName) {
            var dir = Game.map.findExit(creep.room, destRoomName, {
                routeCallback(roomName, fromRoomName) {
                    return ((roomName in Memory.rooms) && ('civiliansAllowed' in Memory.rooms[roomName]) && Memory.rooms[roomName])?1:Infinity;
                }
            });
            target = creep.pos.findClosestByPath(dir);
        } else {
            target = tools.loadPos(Memory.rooms[destRoomName].entry);
        }
        var result = creep.moveTo(target);
        switch(result) {
            case ERR_NO_PATH:
                var step;
                if (creep.pos.x == 0) step = RIGHT;
                if (creep.pos.x == 49) step = LEFT;
                if (creep.pos.y == 0) step = BOTTOM;
                if (creep.pos.y == 49) step = TOP;
                if (step) creep.move(step);
        }
    },
    selectContainer: function(creep, destRoomName, positionsListName, creepAction) {
        var targets = [];
        if (creepAction == 'withdraw') {
            targets = creep.room.find(FIND_DROPPED_RESOURCES, {filter: {resourceType: creep.memory.resourceType}});
            if (targets.length > 0) {
                if (creep.pickup(targets[0]) == ERR_NOT_IN_RANGE) creep.moveTo(targets[0]);
                return;
            }
        }
        var positions = Memory.rooms[destRoomName][positionsListName];
        for (var i = 0; i < positions.length; ++i) {
            var structs = _(creep.room.lookForAt(LOOK_STRUCTURES, positions[i].x, positions[i].y)).filter(
                (s) => 'store' in s && (creepAction != 'withdraw' || s.store[creep.memory.resourceType]>0)
                ).value();
            if (structs.length > 0) targets.push(structs[0]);
        }
        if (targets.length > 0) {
            if (creep[creepAction](targets[0], creep.memory.resourceType) == ERR_NOT_IN_RANGE) creep.moveTo(targets[0]);
        }
    }
}

var stages = {
    load: function(creep) {
        actions[creep.memory.action](creep, creep.memory.targetRoom, 'loadFrom', 'withdraw');
    },
    unload: function(creep) {
        actions[creep.memory.action](creep, creep.memory.homeRoom, 'unloadTo', 'transfer');
    },
    suicide: function(creep) {
        var target = Game.rooms[creep.memory.homeRoom];
        if (!target) return creep.suicide();
        target = target.find(FIND_MY_SPAWNS);
        if (target.length == 0) return creep.suicide();
        target = target[0];
        if (target.recycleCreep(creep) == ERR_NOT_IN_RANGE) creep.moveTo(target);
    }
}

var runner = {
    run: function(creep) {
        if (creep.spawning) return;
        if (!('stage' in creep.memory)) {
            creep.memory.stage = 'load';
            creep.memory.action = 'goRoom';
        }
        if (creep.ticksToLive < 200) creep.memory.stage = 'suicide';
        if (creep.memory.stage == 'load' && _.sum(creep.carry) >= 0.9*creep.carryCapacity) {
            creep.memory.stage = 'unload';
            creep.memory.action = 'goRoom';
        }
        if (creep.memory.stage == 'unload' && _.sum(creep.carry) == 0) {
            creep.memory.stage = 'load';
            creep.memory.action = 'goRoom';
        }
        
        stages[creep.memory.stage](creep);
    },
    describeTarget: function(creep) {
        return 'room '+creep.memory.targetRoom;
    },
    manager: {
        createMemory: function(roleName, homeRoom, targetRoom, resourceType) {
            return {role: roleName, homeRoom: homeRoom, targetRoom: targetRoom, resourceType: resourceType};
        },
        createOffroadBody: function(energyLimit, sizeLimit) {
            if (sizeLimit > 25) sizeLimit = 25;
            sizeLimit = Math.min(sizeLimit, Math.floor(energyLimit / (BODYPART_COST[CARRY] + BODYPART_COST[MOVE])));
            return tools.createBodyFromParts([{count:sizeLimit, part: CARRY}, {count:sizeLimit, part: MOVE}]);
        },
        createRoadBody: function(energyLimit, sizeLimit) {
            if (sizeLimit > 32) sizeLimit = 32;
            sizeLimit = Math.floor(sizeLimit/2);
            sizeLimit = Math.min(sizeLimit, Math.floor(energyLimit / (2*BODYPART_COST[CARRY] + BODYPART_COST[MOVE])));
            return tools.createBodyFromParts([{count:sizeLimit*2, part: CARRY}, {count:sizeLimit, part: MOVE}]);
        }
    }
}

global.transport = {
    planSpawn: function(room, pickUpRoom, resourceType, size) {
        var body = runner.manager.createOffroadBody(room.energyCapacityAvailable, size);
        var memory = runner.manager.createMemory('transport', room.name, pickUpRoom, resourceType);
        var name = tools.getCreepName(memory);
        room.memory.spawnQueue.push({body: body, name: name, memory: memory});
    }
}

module.exports = runner;
