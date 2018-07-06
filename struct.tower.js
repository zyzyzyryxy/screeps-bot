/* var mod = require('struct.tower'); */

var reservations = [];

var towerController = {
    repair: function(tower, repairType, maxHp, anyRange) {
        var closestDamagedStructure = tower.pos.findClosestByRange(FIND_STRUCTURES, {
            filter: (structure) => {return structure.structureType == repairType && structure.hits < maxHp && reservations.indexOf(structure.id) == -1; }
        });
        if(closestDamagedStructure && (anyRange || tower.pos.inRangeTo(closestDamagedStructure, TOWER_OPTIMAL_RANGE))) {
            reservations.push(closestDamagedStructure.id);
            tower.repair(closestDamagedStructure);
            return true;
        }
        return false;
    },
    protectFromNuke: function(tower, defaultWallHeight) {
        var room = tower.room;
        var nukes = room.find(FIND_NUKES);
        if (nukes.length == 0) return false;
        if (protectFromNukes(tower, nukes, room.terminal, defaultWallHeight) || protectFromNukes(tower, nukes, room.storage, defaultWallHeight)) return true;
        var spawns = room.find(FIND_MY_SPAWNS);
        for (var s = spawns.length-1; s>=0; --s) {
            if (protectFromNukes(tower, nukes, spawns[s], defaultWallHeight)) return true;
        }
    },
    defend: function(tower) {
        var closestHostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
        if(closestHostile) {
            tower.attack(closestHostile);
            return true;
        }
        return false;
    },
    heal: function(tower) {
        var closestWounded = tower.pos.findClosestByRange(FIND_MY_CREEPS, {filter: (c) => c.hits < c.hitsMax});
        if (closestWounded) {
            tower.heal(closestWounded);
            return true;
        }
        return false;
    },
    findTowers: function(room) {
        reservations = [];
        return room.find(FIND_MY_STRUCTURES, {
            filter: { structureType: STRUCTURE_TOWER}
        });
    },
    towerEfficiencyAtRange: function(distance) {
        if(distance <= TOWER_OPTIMAL_RANGE) {
            return 1;
        }
        if(distance >= TOWER_FALLOFF_RANGE) {
            return 1 - TOWER_FALLOFF;
        }
        var towerFalloffPerTile = TOWER_FALLOFF / (TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE);
        return 1 - (distance - TOWER_OPTIMAL_RANGE) * towerFalloffPerTile;
    },
    exclude: function(ids) {
        reservations = reservations.concat(ids);
    }
}

var protectFromNukes = function(tower, nukes, importantStruct, defaultWallHeight) {
    if (importantStruct && importantStruct.pos.findInRange(nukes, 3)) {
        var rampart = _(tower.room.lookForAt(LOOK_STRUCTURES, importantStruct.pos)).filter({structureType: STRUCTURE_RAMPART}).value()[0];
        if (!rampart) {
            importantStruct.pos.createConstructionSite(STRUCTURE_RAMPART);
            return false;
        }
        var desiredHeight = defaultWallHeight;
        for (var n = nukes.length-1; n>=0; --n) {
            switch (importantStruct.pos.getRangeTo(nukes[n])) {
                case 0:
                    desiredHeight += NUKE_DAMAGE[0];
                    break;
                case 1:
                case 2:
                    desiredHeight += NUKE_DAMAGE[2];
                    break;
            }
        }
        if (rampart.hits < desiredHeight) {
            tower.repair(rampart);
            return true;
        }
    }
    return false;
}

module.exports = towerController;

global.towerControl = {
    towerEfficiencyAtRange: towerController.towerEfficiencyAtRange
}
