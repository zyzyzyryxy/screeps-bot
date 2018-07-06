let control = {
    isFinished: {
        loadLab: function(creep, task) {
            let creepCarry = (task.resourceType in creep.carry)?creep.carry[task.resourceType]:0;
            let terminalAmount = (task.resourceType in creep.room.terminal.store)?creep.room.terminal.store[task.resourceType]:0
            return task.amount <= 0 || (creepCarry == 0 && terminalAmount == 0);
        },
        unloadLab: function(creep, task) {
            let totalCarry = _.sum(creep.carry);
            let lab = Game.getObjectById(task.labId);
            return (task.amount <= 0 || lab.mineralAmount == 0)  && totalCarry == 0;
        }
    },
    findTask: function(room, carrySize) {
        if (!('boosters' in room.memory.config.labs)) room.memory.config.labs.boosters = {};
        let boosters = room.memory.config.labs.boosters;
        for (let labId in boosters) {
            let lab = Game.getObjectById(labId);
            let res = boosters[labId];
            if (lab.mineralAmount > 0 && lab.mineralType != res) {
                return {action: 'unloadLab', labId: labId, amount: lab.mineralAmount};
            }
            if (lab.mineralAmount < lab.mineralCapacity && room.terminal.store[res] > 0) {
                return {action: 'loadLab', resourceType: res, labId: labId, amount: Math.min(lab.mineralCapacity-lab.mineralAmount, room.terminal.store[res])};
            }
        }
        let react = room.memory.config.labs.react;
        if (react && !(room.memory.config.labs.in1 in boosters) && !(room.memory.config.labs.in2 in boosters)) {
            let lab1 = Game.getObjectById(room.memory.config.labs.in1);
            let lab2 = Game.getObjectById(room.memory.config.labs.in2);
            if (lab1.mineralAmount > 0 && lab1.mineralType != react.reagent1) {
                return {action: 'unloadLab', resourceType: lab1.mineralType, labId: lab1.id, amount: lab1.mineralAmount};
            }
            if (lab2.mineralAmount > 0 && lab2.mineralType != react.reagent2) {
                return {action: 'unloadLab', resourceType: lab2.mineralType, labId: lab2.id, amount: lab2.mineralAmount};
            }
            for (let i in react.use) {
                let lab = Game.getObjectById(react.use[i]);
                if (lab.mineralAmount >= carrySize || lab.mineralAmount > 0 && lab.mineralType != REACTIONS[react.reagent1][react.reagent2]) {
                    return {action: 'unloadLab', resourceType: lab.mineralType, labId: lab.id, amount: lab.mineralAmount};
                }
            }
            if (lab1.mineralAmount <= lab2.mineralAmount && lab1.mineralAmount <= lab1.mineralCapacity - carrySize && room.terminal.store[react.reagent1] > 0) {
                return {action: 'loadLab', resourceType: react.reagent1, labId: lab1.id, amount: carrySize};
            }
            if (lab2.mineralAmount <= lab1.mineralAmount && lab2.mineralAmount <= lab2.mineralCapacity - carrySize && room.terminal.store[react.reagent2] > 0) {
                return {action: 'loadLab', resourceType: react.reagent2, labId: lab2.id, amount: carrySize};
            }
            let mostMineral = 0;
            let mostMineralLab = undefined;
            for (let i in react.use) {
                let lab = Game.getObjectById(react.use[i]);
                if (lab.mineralAmount > mostMineral) {
                    mostMineral = lab.mineralAmount;
                    mostMineralLab = lab;
                }
            }
            if (mostMineral > 0) {
                return {action: 'unloadLab', resourceType: mostMineralLab.mineralType, labId: mostMineralLab.id, amount: mostMineral};
            }
        } else {
            let labsToEmpty = room.find(FIND_MY_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_LAB && s.mineralAmount > 0 && !(s.id in boosters)});
            if (labsToEmpty.length > 0) {
                let lab = labsToEmpty[0];
                return {action: 'unloadLab', resourceType: lab.mineralType, labId: lab.id, amount: lab.mineralAmount};
            }
        }
        return undefined;
    },
    run: {
        loadLab: function(creep, task) {
            let lab = Game.getObjectById(task.labId);
            let carriedAmount = (task.resourceType in creep.carry)?creep.carry[task.resourceType]:0;
            if (carriedAmount > 0) {
                switch (creep.transfer(lab, task.resourceType)) {
                    case ERR_NOT_IN_RANGE: 
                        creep.moveTo(lab);
                        break;
                    case OK:
                        task.amount -= carriedAmount;
                        break;
                }
            } else {
                if (creep.pos.isNearTo(creep.room.terminal)) {
                    let totalCarry = _.sum(creep.carry);
                    let freeCarry = creep.carryCapacity - totalCarry;
                    if (freeCarry < task.amount) {
                        let dumpedAmount = 0;
                        let resourceToDump = null;
                        for (let r in creep.carry) {
                            if (r != task.resourceType && creep.carry[r] > dumpedAmount) {
                                dumpedAmount = creep.carry[r];
                                resourceToDump = r;
                            }
                        }
                        if (resourceToDump) {
                            creep.transfer(creep.room.terminal, resourceToDump, dumpedAmount);
                            freeCarry += dumpedAmount;
                        }
                    }
                    creep.withdraw(creep.room.terminal, task.resourceType, Math.min(Math.min(task.amount, freeCarry), creep.room.terminal.store[task.resourceType]));
                } else {
                    creep.moveTo(creep.room.terminal);
                }
            }
        },
        unloadLab: function(creep, task) {
            let lab = Game.getObjectById(task.labId);
            if (!('resourceType' in task)) task.resourceType = lab.mineralType;

            let totalCarry = _.sum(creep.carry);
            let freeCarry = creep.carryCapacity - totalCarry;
            let currentCarry = creep.carry[task.resourceType];
            
            if (freeCarry == 0 || currentCarry >= task.amount) {
                if (creep.pos.isNearTo(creep.room.terminal)) {
                    for (let r in creep.carry) {
                        if (creep.carry[r] > 0) {
                            creep.transfer(creep.room.terminal, r);
                            if (r == task.resourceType) task.amount =- currentCarry;
                            break;
                        }
                    }
                } else {
                    creep.moveTo(creep.room.terminal);
                }
            } else {
                if (creep.withdraw(lab, task.resourceType) == ERR_NOT_IN_RANGE) {
                    creep.moveTo(lab);
                }
            }
        }
    }
}

module.exports = {
    run: function(creep) {
        if (creep.spawning) return;
        if ('task' in creep.memory && control.isFinished[creep.memory.task.action](creep, creep.memory.task)) {
            delete creep.memory.task;
        }
        if (!('task' in creep.memory) && creep.ticksToLive > 30) {
            let newTask = control.findTask(creep.room, creep.carryCapacity);
            if (newTask) creep.memory.task = newTask;
        }
        if ('task' in creep.memory) {
            creep.say(creep.memory.task.action);
            control.run[creep.memory.task.action](creep, creep.memory.task);
        } else {
            creep.say('Idle');
            creep.moveTo(creep.room.memory.config.labs.waitPos.x, creep.room.memory.config.labs.waitPos.y);
        }
    },
    describeTarget: function(creep) {
        return 'room '+creep.memory.targetRoom;
    }
};

const ensureSupply = function(room, resource, amount) {
    let stock = room.terminal.store[resource];
    let missing = amount - ((stock == null) ? 0 : stock);
    console.log('Ensuring '+amount+' of '+resource+' in '+room+', missing = '+missing);
    if (missing <= 0) return;
    let roomsToDraw = [];
    roomsToDraw = _.sortBy(
        _(Game.rooms).filter(r => 
            (r.name != room.name) && (r.terminal != null) && (r.terminal.store[resource] != null) && (r.terminal.store[resource] >= 100) &&
            r.memory.config.labs.react.reagent1 != resource && r.memory.config.labs.react.reagent2 != resource
        ).value(),
        r=> r.terminal.store[resource]
    );
    while (missing > 0 && roomsToDraw.length > 0) {
        let drawRoom = roomsToDraw.pop();
        let drawAmount = Math.min(missing, drawRoom.terminal.store[resource]);
        console.log('Trying to draw '+resource+' from '+drawRoom);
        let ret = drawRoom.terminal.send(resource, drawAmount, room.name);
        if (ret == OK) {
            missing -= drawAmount;
            console.log('Ordered transfer of '+drawAmount);
        } else {
            console.log('Order to transfer '+drawAmount+' failed with '+ret);
        }
    }
}

global.scientist = {
    planSpawn: function(room, size) {
        if (!(room.name in Game.rooms)) return room+' is not a room object';
        if (!size || size < 1) {
            size = 2;
            console.log('Using default size 2');
        }
        let body = tools.createBodyFromParts([{part: CARRY, count: size*2}, {part: MOVE, count: size}]);
        let memory = {role: 'scientist', homeRoom: room.name, targetRoom: room.name};
        let name = tools.getCreepName(memory);
        room.memory.spawnQueue.push({body: body, name: name, memory: memory});
        return JSON.stringify(room.memory.spawnQueue);
    },
    setReaction: function(room, reagent1, reagent2, amount) {
        if (!(room.name in Game.rooms)) return room+' is not a room object';
        if (RESOURCES_ALL.indexOf(reagent1) == -1) return 'Unknown reagent: '+reagent1;
        if (RESOURCES_ALL.indexOf(reagent2) == -1) return 'Unknown reagent: '+reagent2;
        if (!REACTIONS[reagent1][reagent2]) return 'Unknown reaction';
        if (!('labs' in room.memory.config) || !('react' in room.memory.config.labs)) {
        let labs = room.find(FIND_MY_STRUCTURES, {filter: {structureType: STRUCTURE_LAB}});
        let labsSorted = labs.map((l) => {return {labId: l.id, closeTo: l.pos.findInRange(labs, 2).length}}).sort((a,b) => b.closeTo - a.closeTo);
            room.memory.config.labs = {in1: labsSorted[0].labId, in2: labsSorted[1].labId, react: {use: labsSorted.slice(2).map((l) => l.labId)}};
        }
        room.memory.config.labs.react.reagent1 = reagent1;
        room.memory.config.labs.react.reagent2 = reagent2;
        
        if (amount != null) {
            ensureSupply(room, reagent1, amount);
            ensureSupply(room, reagent2, amount);
        }
        return JSON.stringify(room.memory.config.labs.react);
    },
    setBoosterLab: function(labId, boosterResource) {
        let lab = Game.getObjectById(labId);
        if (lab.structureType != STRUCTURE_LAB) return 'Structure is not a lab!';
        if (_(BOOSTS).filter((b)=>boosterResource in b).size() == 0) return boosterResource+' is not a booster resource!';
        let room = lab.room;
        if (!('labs' in room.memory.config)) room.memory.config.labs = {};
        if (!('boosters' in room.memory.config.labs)) room.memory.config.labs.boosters = {};
        room.memory.config.labs.boosters[labId] = boosterResource;
        if (('react' in room.memory.config.labs) && ('use' in room.memory.config.labs.react)) {
            let idx = room.memory.config.labs.react.use.indexOf(labId);
            if (idx != -1) room.memory.config.labs.react.use.splice(idx, 1);
        }
        return JSON.stringify(room.memory.config.labs.boosters);
    },
    resetBoosterLabs: function(roomName) {
        let labsConfig = Memory.rooms[roomName].config.labs;
        for (let labId in labsConfig.boosters) {
            if (labId != labsConfig.in1 && labId != labsConfig.in2) labsConfig.react.use.push(labId);
        }
        delete labsConfig.boosters;
    },
    findReactionLabs: function(room) {
        let config = room.memory.config.labs;
        if (!('boosters' in config)) config.boosters = {};
        config.react.use = room.find(FIND_MY_STRUCTURES, {filter:
            l=> l.structureType == STRUCTURE_LAB && l.id != config.in1 && l.id != config.in2 && !(l.id in config.boosters)
        }).map(l=>l.id);
        return config.react.use;
    }
}
