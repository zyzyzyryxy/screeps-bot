module.exports = {
    run: function(creep) {
        var nuker = Game.getObjectById(creep.memory.nukerId);
        var terminal = creep.room.terminal;
        if (creep.carry.energy > 0 || creep.carry[RESOURCE_GHODIUM] > 0) {
            if (creep.pos.isNearTo(nuker)) {
                if (creep.carry.energy > 0) {
                    creep.transfer(nuker, RESOURCE_ENERGY);
                } else {
                    creep.transfer(nuker, RESOURCE_GHODIUM);
                }
                creep.moveTo(terminal);
            } else {
                creep.moveTo(nuker);
            }
        } else {
            if (creep.pos.isNearTo(terminal)) {
                if (nuker.energy < nuker.energyCapacity) {
                    var amount = nuker.energyCapacity - nuker.energy;
                    if (amount > creep.carryCapacity) amount = creep.carryCapacity;
                    creep.withdraw(terminal, RESOURCE_ENERGY, amount);
                } else if (nuker.ghodium < nuker.ghodiumCapacity) {
                    var amount = nuker.ghodiumCapacity - nuker.ghodium;
                    if (amount > creep.carryCapacity) amount = creep.carryCapacity;
                    creep.withdraw(terminal, RESOURCE_GHODIUM, amount);
                }
                creep.moveTo(nuker);
            } else {
                creep.moveTo(terminal);
            }
        }
    },
    describeTarget: function(creep) {
        return 'this room';
    }
};

global.nuker = {
    planSpawn: function(room) {
        var nuker = room.find(FIND_MY_STRUCTURES, {filter: {structureType: STRUCTURE_NUKER}});
        if (!nuker) return 'No nuker in room '+room;
        room.memory.spawnQueue.push({body: [CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE], name: 'Nuker_'+room.name, memory: {role: 'nuker', nukerId: nuker[0].id}});
        return JSON.stringify(room.memory.spawnQueue);
    }
}