let movelr = require('util.movelr');

module.exports = {
    run: function(creep) {
        let target = Game.flags[creep.memory.flagName].pos;
        let start = Game.cpu.getUsed();
        let ret = movelr.run(creep, target);
        let used = Game.cpu.getUsed() - start;
        creep.memory.stats.push({fatigue: creep.fatigue, cpu: used, return: ret, tick: Game.time});
        if (creep.ticksToLive == 1) Game.notify('Racer stats: '+JSON.stringify(creep.memory.stats));
        
    },
    describeTarget: function(creep) {
        return 'flag '+creep.memory.flagName;
    }
};

global.racer = {
    planSpawn(roomName, flagName) {
        const room = Game.rooms[roomName];
        room.memory.spawnQueue.push({body: [MOVE], name: 'Racer_'+flagName, memory: {role: 'racer', flagName: flagName, stats: []}});
    }
}