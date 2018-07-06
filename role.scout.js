let findDestination = function(roomName) {
    let dest;
    if (roomName in Game.rooms) {
        dest = Game.rooms[roomName].controller.pos;
    } else if ((roomName in Memory.rooms) && ('controllerPos' in Memory.rooms[roomName])) {
        dest = tools.loadPos(Memory.rooms[roomName].controllerPos);
    } else {
        dest = new RoomPosition(25, 25, roomName);
    }
    return dest;
}

let getNextTarget = function(creep) {
    let nextRoom = creep.memory.targetRooms.shift();
    if (!nextRoom) creep.suicide();
    creep.memory.targetPos = findDestination(nextRoom);
}

module.exports = {
    run: function(creep) {
        if (!('targetPos' in creep.memory)) {
            getNextTarget(creep);
        }
        let target;
        if (tools.isPositionInsideRoom(creep.pos, creep.memory.targetPos.roomName)) {
            target = creep.room.controller;
        } else {
            target = tools.loadPos(creep.memory.targetPos);
        }

        if (!target) console.log('Scout '+creep.name+' cannot get target: '+ creep.memory.targetPos);

        if (creep.pos.isNearTo(target)) {
            creep.signController(target, creep.room.memory.sign);
            getNextTarget(creep);
        } else {
            creep.moveTo(target);
        }
    },
    describeTarget: function(creep) {
        if (creep.memory.targetPos) {
            return 'room '+creep.memory.targetPos.roomName;
        } else {
            return 'room '+creep.memory.targetRooms[0];
        }
    }
};

global.scout = {
    planSpawn: function(homeRoom, rooms) {
        if (rooms == undefined) rooms = this.findRoomsToSign();
        if (rooms.length == 0) {
            return 'Nothing to sign';
        }
        homeRoom.memory.spawnQueue.push({body: [MOVE], name: 'RoomSigner', memory: {role: 'scout', homeRoom: homeRoom.name, targetRooms: rooms}});
    },
    findRoomsToSign: function() {
        let roomsList = [];
        for (roomName in Game.rooms) {
            let controller = Game.rooms[roomName].controller;
            if (!controller) continue;
            let sign = controller.sign;
            if (!sign || sign.username != 'Zyzyzyryxy' || sign.text != Memory.rooms[roomName].sign || sign.time < Game.time - 10*60*24*5) {
                roomsList.push(roomName);
            }
        }
        return roomsList;
    },
    setRoomSign: function(roomName, message, controllerPos) {
        if (!(roomName in Memory.rooms)) Memory.rooms[roomName] = {};
        Memory.rooms[roomName].sign = message;
        if (roomName in Game.rooms) {
            let controller = Game.rooms[roomName].controller;
            if (controller) {
                Memory.rooms[roomName].controllerPos = controller.pos;
            }
        } else if (controllerPos != undefined){
            Memory.rooms[roomName].controllerPos = controllerPos;
        }
    },
    setRoomSignFromTemplate: function(roomName, roomDescription) {
        this.setRoomSign(roomName, '[' + Memory.pactName + '] ' + roomDescription + ', '+Memory.warningMessage);
        
    },
    signMaintainedRooms: function(homeRoom) {
        for (let roonName in Memory.rooms[homeRoom].config.maintainRooms) {
            this.setRoomSignFromTemplate(roomName, 'Controlled sector');
        }
    },
    signMines: function(homeRoom) {
        let mines = Memory.rooms[homeRoom].config.mines;
        for (let m in mines) {
            this.setRoomSignFromTemplate(mines[m].pos.roomName, 'Mining operations');
        }
    },
    signOwnedRooms: function() {
        for (let s in Game.spawns) {
            this.setRoomSignFromTemplate(Game.spawns[s].room.name, 'Sector claimed');
        }
    },
    setSignParameters: function(pactName, warningMessage) {
        Memory.pactName = pactName;
        Memory.warningMessage = warningMessage;
    }
}