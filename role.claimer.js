/* let mod = require('role.claimer'); */

let runner = {
    run: function(creep) {
        if (creep.spawning) return;
        let mem = creep.memory;
        if (Game.rooms[mem.targetRoom] == null) {
            return creep.moveTo(new RoomPosition(25, 25, mem.targetRoom));
        }
        let target = Game.rooms[mem.targetRoom].controller;

        if (creep.pos.isNearTo(target)) {
            creep[mem.task+'Controller'](target);
            if ('sign' in creep.room.memory) {
                if (!target.sign || target.sign.text != creep.room.memory.sign) {
                    creep.signController(target, creep.room.memory.sign);
                }
            }
        } else {
            let ignoreWalls = creep.getActiveBodyparts(ATTACK) > 0 && mem.targetRoom == creep.room.name;
            creep.moveTo(target, {ignoreDestructibleStructures: ignoreWalls});
        }

        creep.memory = mem;
    },
    describeTarget: function(creep) {
        return 'room '+creep.memory.targetRoom;
    },
    manager: {
        createMemory: function(roleName, home, targetRoom, task) {
            let defaultSign;
            let memory;
            if (task == 'claim') {
                defaultSign = '[Ypsilon Pact] Sector claimed, no tresspassing!';
                memory = { role: roleName, homeRoom: home, targetRoom: targetRoom, task: 'claim'};
            } else if (task == 'attack') {
                memory = { role: roleName, homeRoom: home, targetRoom: targetRoom, task: 'attack'};
            } else {
                defaultSign = '[Ypsilon Pact] Controlled sector, no tresspassing!';
                memory = { role: roleName, homeRoom: home, targetRoom: targetRoom, task: 'reserve'};
            }
            if (!('sign' in Memory.rooms)) Memory.rooms[targetRoom].sign = defaultSign;
            return memory;
        },
        getBodyForCostLimit: function(maxCosts) {
            let count = Math.floor(maxCosts / (BODYPART_COST[CLAIM]+BODYPART_COST[MOVE]));
            return tools.createBodyFromParts([{part: CLAIM, count: count}, {part: MOVE, count: count}]);
        }
    }
}

global.claimer = {
    planSpawn: function(room, targetRoom, task) {
        if (!task) return 'planSpawn(room, targetRoom, task) where task in {claim, reserve, attack}';
        let body;
        if (task == 'claim') {
            body = [CLAIM, MOVE];
        } else {
            body = runner.manager.getBodyForCostLimit(room.energyCapacityAvailable);
        }
        let memory = runner.manager.createMemory('claimer', room.name, targetRoom, task);
        let name = tools.getCreepName(memory);
        room.memory.spawnQueue.push({body: body, name: name, memory: memory});
        return JSON.stringify(room.memory.spawnQueue);
    }
};

module.exports = runner;
