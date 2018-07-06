const badOrders = ['59ff60f15846c661d592b6c8'];

module.exports = {
    manageSurplusResources: function(room) {
        let mineralConfig = room.memory.mineral;
        if (!('minAmount' in mineralConfig)) mineralConfig.minAmount = 10000;
        if (!('minPrice' in mineralConfig)) mineralConfig.minPrice = 0.1;
        if (!('sendSurplusBatchSize' in mineralConfig)) mineralConfig.sendSurplusBatchSize = 1000;
        if (room.terminal == null || room.terminal.cooldown > 0) return 'no terminal or terminal cooling down';
        let mineralType = mineralConfig.type;
        if (room.terminal.store[mineralType] == null || room.terminal.store[mineralType] <= mineralConfig.minAmount) {
            for (let m in room.terminal.store) {
                if (Memory.sales[m] != null) {
                    let msg = sellSurplus(room, m, room.terminal.store[m], Memory.sales[m]);
                    console.log(msg);
                    return msg;
                }
            }
            return 'No mineral in terminal or mineral not set';
        }
        let surplus = room.terminal.store[mineralType] - mineralConfig.minAmount;
        if (surplus <= 100) return 'no surplus / little surplus';
        if (mineralConfig.sendSurplusTo != undefined) {
            return transferSurplus(room, mineralType, Math.min(surplus, mineralConfig.sendSurplusBatchSize), mineralConfig.sendSurplusTo);
        } else {
            return sellSurplus(room, mineralType, surplus, mineralConfig.minPrice);
        }
    }
};

let limitOrderSizeToAvailableEnergy = function(amount, fromRoom, toRoom, energy) {
    let energyCost = Game.market.calcTransactionCost(amount, fromRoom, toRoom);
    if (energyCost > energy) {
        return Math.floor(amount * energy / energyCost);
    }
    return amount;
}

let transferSurplus = function(room, mineralType, amount, targetRoomName) {
    let amountToSend = limitOrderSizeToAvailableEnergy(amount, room.name, targetRoomName, room.terminal.store.energy);
    let result = room.terminal.send(mineralType, amountToSend, targetRoomName);
    if (result == 0) {
        return 'Transfer of '+amountToSend+' of '+mineralType+' to room '+targetRoomName+' completed successfully';
    } else {
        return 'Transfer of '+amountToSend+' of '+mineralType+' to room '+targetRoomName+' failed with error '+result;
    }
}

let sellSurplus = function(room, mineralType, surplus, minPrice) {
    console.log('Trying to sell '+surplus+' of '+mineralType+' from '+room+' at '+minPrice);
    let orders = Game.market.getAllOrders(
        order => order.resourceType == mineralType &&
        order.type == ORDER_BUY && order.amount >= 10);
    orders.sort(function(a,b){
        if (b.price < a.price) return -1;
        if (b.price > a.price) return 1;
        return Game.map.getRoomLinearDistance(room.name, b.roomName, true) - Game.map.getRoomLinearDistance(room.name, a.roomName, true);
    });
    console.log('Found '+orders.length+' orders with best price '+orders[0].price);
    let firstGood = 0;
    while (firstGood < orders.length && badOrders.indexOf(orders[firstGood].id) != -1) {
        ++firstGood;
    }
    if (orders.length > firstGood && orders[firstGood].price >= minPrice) {
        let amountToTrade = Math.min(orders[firstGood].amount, surplus);
        amountToTrade = limitOrderSizeToAvailableEnergy(amountToTrade, room.name, orders[firstGood].roomName, room.terminal.store.energy);
        let result = Game.market.deal(orders[firstGood].id, amountToTrade, room.name);
        if (result == 0) {
            console.log('Sale of '+amountToTrade+' of '+mineralType+' completed successfully to order '+orders[0].id+', result '+result);
            return;
        } else {
            console.log('Sale of '+amountToTrade+' of '+mineralType+' failed with error '+result);
            return;
        }
    }
}

global.trade = {
    buyCheapest: function(room, resourceType, targetAmount, maxPrice, minOrder) {
        if (room.terminal.cooldown) return 'Terminal is still cooling down';
        if (!minOrder) minOrder = 1;
        let currentAmount = room.terminal.store[resourceType];
        if (!currentAmount) currentAmount = 0;
        let maxBuy = targetAmount - currentAmount;
        console.log('Have '+currentAmount+', want '+targetAmount+', need to buy '+maxBuy);
        if (maxBuy <= 0) {
            return 'Already have target amount!';
        }
        let orders = Game.market.getAllOrders((o) => o.type == ORDER_SELL && o.resourceType == resourceType && o.amount >= minOrder).sort((a,b) => a.price-b.price);
        if (orders.length == 0) {
            return 'No orders found!';
        }
        if (orders[0].price > maxPrice) {
            return 'Cheapest order too pricey! '+orders[0].price+'>'+maxPrice;
        }
        let amnt = Math.min(maxBuy, orders[0].amount);
        let ret = Game.market.deal(orders[0].id, amnt, room.name);
        return 'Buying '+amnt+' at '+orders[0].price+', status: '+ret;
    },
    sendAll: function(resource, fromRoom, toRoom) {
        if (!Game.map.isRoomAvailable(fromRoom)) return fromRoom+' is not a room';
        if (!Game.map.isRoomAvailable(toRoom)) return toRoom+' is not a room';
        if (RESOURCES_ALL.indexOf(resource) == -1) return resource+' is not a resource';
        return Game.rooms[fromRoom].terminal.send(resource, Game.rooms[fromRoom].terminal.store[resource], toRoom);
    },
    send: function(resource, amount, fromRoom, toRoom) {
        if (!Game.map.isRoomAvailable(fromRoom)) return fromRoom+' is not a room';
        if (!Game.map.isRoomAvailable(toRoom)) return toRoom+' is not a room';
        if (RESOURCES_ALL.indexOf(resource) == -1) return resource+' is not a resource';
        return Game.rooms[fromRoom].terminal.send(resource, amount, toRoom);
    },
    sumOutgoingTo: function(resource, user) {
        return _(Game.market.outgoingTransactions).filter({resourceType: resource, recipient: {username: user}}).map('amount').sum();
    },
    setOrdersFor: function(mineral, minPrice) {
        let roomsWithMineral = _(Game.rooms)
            .filter(r=>r.terminal != null && r.terminal.store[mineral] != null)
            .value();
        console.log(JSON.stringify(roomsWithMineral));
        for (let r of roomsWithMineral) {
            console.log('Creating order for '+r.terminal.store[mineral]+' in '+r.name);
            Game.market.createOrder(ORDER_SELL, mineral, minPrice, r.terminal.store[mineral], r.name);
        }
    },
    manageOrders: function(changes) {
        if (changes == null) changes = {};
        for (let id in Game.market.orders) {
            let order = Game.market.orders[id];
            if (order.active && !(order.amount < changes.minAmount)) {
                let newPrice;
                if (changes.buyChange != null && order.type == ORDER_BUY) {
                    newPrice = Math.floor(changes.buyChange * order.price * 1000) / 1000;
                    console.log('Change order '+id+': change buy price to '+newPrice);
                }
                if (changes.sellChange != null && order.type == ORDER_SELL) {
                    newPrice = Math.floor(changes.sellChange * order.price * 1000) / 1000;
                    console.log('Change order '+id+': change sell price to '+newPrice);
                }
                if (newPrice != null) Game.market.changeOrderPrice(id, newPrice);
            } else {
                console.log('Cancelling order '+id+' with amount '+order.amount);
                Game.market.cancelOrder(id);
            }
        }
    }
}

global.manageSurplusResources = module.exports.manageSurplusResources;