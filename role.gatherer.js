var stages = {
    extracting: function(creep) {
        var target = Game.getObjectById(creep.memory.targetId);
        if (creep.harvest(target) == ERR_NOT_IN_RANGE) {
            creep.moveTo(target);
        }
    },
    unloading: function(creep) {
        var target = creep.room.terminal;
        if (!target) target = creep.room.storage;
        if (creep.transfer(target, creep.memory.mineralType) == ERR_NOT_IN_RANGE) {
            creep.moveTo(target);
        }
    },
    suicide: function(creep) {
        var spawn;
        if ('spawnId' in creep.memory) {
            spawn = Game.getObjectById(creep.memory.spawnId);
        } else {
            spawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS);
            creep.memory.spawnId = spawn.id;
        }
        if (creep.pos.isNearTo(spawn)) {
            spawn.recycleCreep(creep);
        } else {
            creep.moveTo(spawn);
        }
    },
}

var gatherer = {
    run: function(creep) {
        if (!('stage' in creep.memory)) {
            var minerals = creep.room.find(FIND_MINERALS);
            if (minerals.length == 0) {
                creep.memory.stage = 'suicide';
            } else {
                creep.memory.stage = 'extracting';
                creep.memory.targetId = minerals[0].id;
                creep.memory.mineralType = minerals[0].mineralType;
            }
        }
        if (creep.spawning) return;

        var creepWork = creep.getActiveBodyparts(WORK);
        if (creep.memory.stage == 'extracting' && _.sum(creep.carry) > creep.carryCapacity - creepWork*HARVEST_MINERAL_POWER) creep.memory.stage = 'unloading';
        if (creep.memory.stage == 'unloading' && _.sum(creep.carry) == 0) creep.memory.stage = creep.ticksToLive > (EXTRACTOR_COOLDOWN*creep.carryCapacity/creepWork+100) ? 'extracting' : 'suicide';
        
        if (creep.memory.stage in stages) {
            stages[creep.memory.stage](creep);
        } else {
            console.log(creep+' is in unknown stage '+creep.memory.stage+'!');
        }
    },
    describeTarget: function(creep) {
        return 'room '+creep.pos.roomName;
    }
}

module.exports = gatherer;