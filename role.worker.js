/* var mod = require('role.worker'); */

var runner = {
    run: function(creep) {
        if (creep.spawning) return;
        var mem = creep.memory;

        if (mem.stage == 'go') mem = this.go(creep, mem);
        if (mem.stage == 'find_container') mem = this.initContainer(creep, mem);
        if (mem.stage == 'build_container') mem = this.buildContainer(creep, mem);
        if (mem.stage == 'work') mem = this.work(creep, mem);

        creep.memory = mem;
    },
    go: function(creep, mem) {
        var dest = new RoomPosition(mem.workAt.x, mem.workAt.y, mem.workAt.roomName);
        if (creep.pos.isEqualTo(dest)) {
            mem.stage = 'find_container';
        } else {
            creep.moveTo(dest);
            mem.travelTime += 1;
        }
        return mem;
    },
    initContainer: function(creep, mem) {
        var containers = creep.pos.findInRange(FIND_STRUCTURES, 1, {filter: {structureType: STRUCTURE_STORAGE}});
        if (containers.length == 0) {
            containers = creep.pos.findInRange(FIND_STRUCTURES, 1, {filter: {structureType: STRUCTURE_LINK}});
        }
        if (containers.length == 0) {
            containers = creep.pos.findInRange(FIND_STRUCTURES, 1, {filter: {structureType: STRUCTURE_CONTAINER}});
        }
        if (containers.length > 0) {
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
        if (creep.carry.energy < 2*creep.getActiveBodyparts(WORK)*BUILD_POWER) tools.pickupNearbyEnergyDrops(creep);
        var source = Game.getObjectById(mem.sourceId);
        var site = Game.getObjectById(mem.constructionSiteId);
        if (site) {
            if (creep.carry.energy >= creep.getActiveBodyparts(WORK) * BUILD_POWER) creep.build(site);
            else creep.harvest(source);
        } else {
            var containers = creep.pos.findInRange(FIND_STRUCTURES, 1, {filter: {structureType: STRUCTURE_CONTAINER}});
            if (containers.length) {
                mem.containerId = containers[0].id;
                mem.stage = 'work';
            } else {
                mem.stage = 'find_container';
            }
        }
        return mem;
    },
    work: function(creep, mem) {
        tools.pickupNearbyEnergyDrops(creep);
        if (creep.carry.energy < 2*creep.getActiveBodyparts(WORK)*UPGRADE_CONTROLLER_POWER) {
            var container = Game.getObjectById(mem.containerId);
            if (container) {
                creep.withdraw(container, RESOURCE_ENERGY);
            } else {
                mem.stage = 'find_container';
            }
        }
        creep.upgradeController(creep.room.controller);
        return mem;
    },
    describeTarget: function(creep) {
        return 'pos '+tools.loadPos(creep.memory.workAt);
    },
    manager: {
        createMemory: function(roleName, home, workAt, task) {
            return { role: roleName, homeRoom: home, workAt: workAt, stage: 'go', task: task, travelTime: 0};
        },
        getBodySizeForLimits: function(maxCosts, maxWork) {
            if (!maxWork || maxWork > 32) maxWork = 32;
            
            return Math.min(2*Math.floor((maxCosts - 2*BODYPART_COST[CARRY]) / (2*BODYPART_COST[WORK] + BODYPART_COST[MOVE])), maxWork);
        },
        getBodyForSize: function(workParts) {
            var moveParts = Math.floor(workParts / 2);
            return new Array(moveParts).fill(MOVE).concat(new Array(workParts).fill(WORK)).concat([CARRY, CARRY]);
        }
    }
}
global.upgrader = {
    manager: runner.manager
}

module.exports = runner;
