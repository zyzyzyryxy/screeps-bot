var findBodyForInvaders = function(hostiles, energyLimit) {
    var enemyHealPower = 0;
    var enemyAttackPower = 0;
    var enemyRangedAttackPower = 0;
    var enemyToughnessBoost = 1;
    for (var h in hostiles) {
        for (var p in hostiles[h].body) {
            var part = hostiles[h].body[p];
            switch (part.type) {
                case ATTACK:
                    if (part.boost) {
                        enemyAttackPower += BOOSTS[part.type][part.boost].attack*ATTACK_POWER;
                    } else {
                        enemyAttackPower += ATTACK_POWER;
                    }
                    break;
                case HEAL:
                    if (part.boost) {
                        enemyHealPower += BOOSTS[part.type][part.boost].heal*HEAL_POWER;
                    } else {
                        enemyHealPower += HEAL_POWER;
                    }
                    break;
                case RANGED_ATTACK:
                    if (part.boost) {
                        enemyRangedAttackPower += BOOSTS[part.type][part.boost].rangedAttack*RANGED_ATTACK_POWER;
                    } else {
                        enemyRangedAttackPower += RANGED_ATTACK_POWER;
                    }
                    break;
                case TOUGH:
                    if (part.boost) {
                        enemyToughnessBoost = Math.min(BOOSTS[part.type][part.boost].damage, enemyToughnessBoost);
                    }
            }
        }
    }
    console.log('Enemies have '+enemyHealPower+' heal, '+enemyAttackPower+' attack and '+enemyRangedAttackPower+' ranged attack, '+enemyToughnessBoost+' damage reduction.');
    enemyHealPower /= enemyToughnessBoost;
    console.log('Effective heal: '+enemyHealPower);
    if (enemyAttackPower == 0 && enemyRangedAttackPower == 0) return null;
    var attackNeed = Math.ceil(enemyAttackPower / ATTACK_POWER) + 2;
    var rangedNeed = Math.ceil(enemyHealPower / RANGED_ATTACK_POWER);
    if (rangedNeed == 0) rangedNeed = 1;
    var healNeed = Math.ceil(enemyRangedAttackPower / HEAL_POWER);
    var toughNeed = Math.ceil(enemyRangedAttackPower / 100);
    var moveNeed = attackNeed + healNeed + toughNeed + rangedNeed;
    if (toughNeed + moveNeed + attackNeed + rangedNeed + healNeed > MAX_CREEP_SIZE) {
        return null;
    }
    var body = tools.createBodyFromParts([{part: TOUGH, count: toughNeed}, {part: MOVE, count: moveNeed}, {part: ATTACK, count: attackNeed}, {part: RANGED_ATTACK, count: rangedNeed}, {part: HEAL, count: healNeed}]);
    if (tools.calcBodyCost(body) > energyLimit) body = undefined;
    return body;
}

var runner = {
    run: function(creep) {
        var mem = this.initMemIfNeeded(creep);
        if (creep.spawning) return;
        var attacking = false;
        if (creep.room.name != mem.currentPost.roomName && creep.room.controller && creep.room.controller.owner && !creep.room.controller.my) return this.goToPost(creep, mem);
        if (creep.room.name != mem.currentPost.roomName && creep.room.controller && creep.room.controller.reservation && creep.room.controller.reservation.username != 'Zyzyzyryxy') return this.goToPost(creep, mem);
        var enemyInRange = this.findClosestEnemyInRange(creep);
        if (enemyInRange) {
            creep.rangedAttack(enemyInRange);
            if (enemyInRange.getActiveBodyparts(ATTACK) == 0 && creep.getActiveBodyparts(ATTACK) > 0 || creep.getActiveBodyparts(RANGED_ATTACK) == 0) {
                creep.attack(enemyInRange);
                creep.moveTo(enemyInRange);
                attacking = true;
            }
        }
        if (creep.getActiveBodyparts(HEAL) > 0 && (creep.hits < creep.hitsMax && !attacking || attacking && (creep.hits < creep.hitsMax) && (creep.getActiveBodyparts(TOUGH) == 0))) creep.heal(creep);
        
        if (enemyInRange && creep.pos.getRangeTo(enemyInRange) == 3) creep.moveTo(enemyInRange); //don't let him escape
        if (mem.waypoints.length >= 1) this.goToPost(creep, mem);
        else {
            if (!enemyInRange) {
                var enemiesInRoom = creep.room.find(FIND_HOSTILE_CREEPS);
                var closestEnemy;
                if (enemiesInRoom.length > 0 && (closestEnemy = creep.pos.findClosestByPath(enemiesInRoom))) {
                    creep.room.visual.circle(closestEnemy.pos, {radius: 0.5, opacity: 0, stroke: '#ff7700'});
                    if (creep.getActiveBodyparts(RANGED_ATTACK) == 0) {
                        creep.attack(closestEnemy);
                    }
                    creep.moveTo(closestEnemy);
                } else {
                    var wounded = creep.pos.findClosestByPath(FIND_MY_CREEPS, {filter: (c) => c.hits < c.hitsMax});
                    if (wounded) {
                        this.healSomeone(creep, wounded);
                    } else {
                        var hostileStructure = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, {filter: (s) => s.structureType != STRUCTURE_CONTROLLER});
                        if (hostileStructure) {
                            creep.rangedAttack(hostileStructure);
                            creep.moveTo(hostileStructure);
                        } else {
                            this.goToPost(creep, mem);
                        }
                    }
                }
            }
        }

        creep.memory = mem;
    },
    initMemIfNeeded: function(creep) {
        var mem = creep.memory;
        if (!('waypoints' in mem)) mem.waypoints = [];
        if (!('currentPost' in mem)) {
            if (mem.waypoints.length > 0) mem.currentPost = mem.waypoints[0];
            else mem.currentPost = creep.pos;
        }
        return mem;
    },
    healSomeone: function(creep, wounded) {
        var distance = creep.pos.getRangeTo(wounded);
        if (distance == 1) creep.heal(wounded);
        if (distance <= 3) creep.rangedHeal(wounded);
        if (distance > 1) creep.moveTo(wounded);
    },
    findClosestEnemyInRange: function(creep) {
        var range = creep.getActiveBodyparts(RANGED_ATTACK) == 0?1:3;
        var enemiesInRange = creep.pos.findInRange(FIND_HOSTILE_CREEPS, range);
        var target;
        if (enemiesInRange.length == 0) target = null;
        else if (enemiesInRange.length == 1) target = enemiesInRange[0];
        else target = creep.pos.findClosestByRange(enemiesInRange);
        if (target) creep.room.visual.circle(target.pos, {radius: 0.5, stroke: '#ff0000'});
        return target;
    },
    goToPost: function(creep, mem) {
        creep.say('go');
        if (creep.hits < creep.hitsMax && creep.getActiveBodyparts(HEAL) > 0) creep.heal(creep);
        var post = tools.loadPos(mem.currentPost);
        if (creep.pos.isNearTo(post) && mem.waypoints.length >= 1) {
            post = tools.loadPos(mem.waypoints.shift());
            mem.currentPost = post;
        }
        if (!creep.pos.isEqualTo(post)) creep.moveTo(post);
    },
    describeTarget: function(creep) {
        if (creep.memory.waypoints.length > 0) {
            return 'room '+creep.memory.waypoints[0].roomName;
        } else {
            return '(no waypoint)';
        }
    },
    manager: {
        createMemory: function(roleName, home, waypoints, persistent, body) {
            return { role: roleName, homeRoom: home, waypoints: waypoints, persistent: persistent, body: body};
        },
        planSpawnGuard: function(room, body, waypoints) {
            room.memory.spawnQueue.unshift({body: body, memory: this.createMemory('guard', room.name, waypoints, false, body)});
        },
        setupRoomDefence: function(room, hostiles) {
            console.log('Setting up defence for '+room);
            var towers;
            if (room) {
                towers = room.find(FIND_MY_STRUCTURES, {filter: {structureType: STRUCTURE_TOWER}});
            } else {
                towers = [];
            }
            var guardPost = tools.loadPos(room.memory.guardPost);
            if (!guardPost) guardPost = new RoomPosition(25, 25, room.name);
            console.log('Guard post is at '+guardPost);
            if (towers.length < hostiles.length) {
                console.log('Creating new guard');
                var roomWithSpawn = Game.rooms[room.memory.managedFrom];
                if (!roomWithSpawn || roomWithSpawn.energyCapacityAvailable < 1210) return 'Spawn room too weak';
                console.log('Creating new guard in '+roomWithSpawn);
                var body = findBodyForInvaders(hostiles, roomWithSpawn.energyCapacityAvailable);
                console.log('Found body: '+body);
                if (body) this.planSpawnGuard(roomWithSpawn, body, [guardPost]);
            }
        }
    }
}

global.guard = {
    planSpawn: function(room, body, waypoint) {
        runner.manager.planSpawnGuard(room, body, [waypoint]);
    },
    planSpawnWithPath: function(room, body, waypoints) {
        runner.manager.planSpawnGuard(room, body, waypoints);
    },
    findBodyForInvaders: findBodyForInvaders,
    planRoomDefence: function(room) {
        var hostiles = room.find(FIND_HOSTILE_CREEPS);
        if (hostiles.length == 0) return 'No hostiles';
        return runner.manager.setupRoomDefence(room, hostiles);
    }
}

module.exports = runner;
