const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { 
  getCardValue, 
  calculateHandValue, 
  createDeck, 
  dealCard, 
  generatePassword 
} = require('./game');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

let lobbies = {};
let lobbyCounter = 1; // 用於生成連續的大廳ID

app.use(express.static(path.join(__dirname, 'public')));

function startGame(lobbyId) {
  const lobby = lobbies[lobbyId];
  const deck = createDeck();
  lobby.deck = deck;
  lobby.currentPlayerIndex = 0;

  lobby.players.forEach(player => {
    player.hand = [dealCard(deck), dealCard(deck)];
    player.finished = false;
    player.result = null;
  });

  const dealer = lobby.dealer;
  dealer.hand = [dealCard(deck), dealCard(deck)];
  dealer.finished = false;

  lobby.players.forEach(player => {
    const playerHandValue = calculateHandValue(player.hand);
    if (playerHandValue === 21 && player.hand.length === 2) {
      player.blackjack = true;
    }
  });

  const dealerHandValue = calculateHandValue(dealer.hand);
  if (dealerHandValue === 21 && dealer.hand.length === 2) {
    dealer.blackjack = true;
  }

  io.to(lobbyId).emit('updateLobby', lobby.players);
  io.to(lobbyId).emit('gameStarted', lobby);
}

function dealerTurn(lobbyId) {
  const lobby = lobbies[lobbyId];
  const dealer = lobby.dealer;
  while (calculateHandValue(dealer.hand) < 17) {
    const card = dealCard(lobby.deck);
    if (card !== undefined) {
      dealer.hand.push(card);
    } else {
      break;
    }
  }
  dealer.finished = true;
  io.to(lobbyId).emit('updateDealer', dealer);
  endGame(lobbyId);
}

function endGame(lobbyId) {
  const lobby = lobbies[lobbyId];
  const dealer = lobby.dealer;
  const dealerHandValue = calculateHandValue(dealer.hand);

  let highestValue = 0;
  let winners = [];

  lobby.players.forEach(player => {
    const playerHandValue = calculateHandValue(player.hand);
    if (playerHandValue <= 21) {
      if (playerHandValue > highestValue) {
        highestValue = playerHandValue;
        winners = [player];
      } else if (playerHandValue === highestValue) {
        winners.push(player);
      }
    }
  });

  if (dealerHandValue <= 21 && dealerHandValue > highestValue) {
    highestValue = dealerHandValue;
    winners = [dealer];
  } else if (dealerHandValue === highestValue) {
    winners.push(dealer);
  }

  lobby.players.forEach(player => {
    if (winners.includes(player)) {
      if (winners.length === 1) {
        player.result = 'win';
        player.balance += player.bet * 2;
      } else {
        player.result = 'push';
        player.balance += player.bet;
      }
    } else {
      player.result = 'lose';
    }
    player.bet = 0; // 重置賭注
  });

  io.to(lobbyId).emit('gameEnded', lobby);
}

function generateLobbyId() {
  let lobbyId = lobbyCounter.toString().padStart(2, '0');
  lobbyCounter++;
  return lobbyId;
}

function sendLobbyList() {
  const lobbyList = Object.keys(lobbies).map(id => ({
    id,
    players: lobbies[id].players.length
  }));
  io.emit('updateLobbyList', lobbyList);
}

setInterval(sendLobbyList, 5000);

io.on('connection', (socket) => {
  console.log('New client connected');
  sendLobbyList();

  socket.on('createLobby', (userId) => {
    const lobbyId = generateLobbyId();
    const password = generatePassword();
    lobbies[lobbyId] = {
      id: lobbyId,
      password: password,
      players: [{ id: userId, ready: false, balance: 1000, bet: 0 }],
      dealer: { id: 'dealer', isDealer: true, hand: [], finished: false },
      deck: [],
      gameStarted: false,
      currentPlayerIndex: 0
    };
    socket.join(lobbyId);
    socket.emit('lobbyCreated', { lobbyId, password });
    io.to(lobbyId).emit('updateLobby', lobbies[lobbyId].players);
    console.log(`Client ${userId} created lobby ${lobbyId} with password ${password}`);
    sendLobbyList();
  });

  socket.on('joinLobby', (lobbyId, userId, password) => {
    if (lobbies[lobbyId] && lobbies[lobbyId].password === password) {
      if (lobbies[lobbyId].players.length < 5) {
        lobbies[lobbyId].players.push({ id: userId, ready: false, balance: 1000, bet: 0 });
        socket.join(lobbyId);
        socket.emit('lobbyJoined', lobbyId);
        io.to(lobbyId).emit('updateLobby', lobbies[lobbyId].players);
        console.log(`Client ${userId} joined lobby ${lobbyId}`);
      } else {
        socket.emit('lobbyFull', lobbyId);
      }
    } else {
      socket.emit('lobbyNotFoundOrWrongPassword', lobbyId);
    }
  });

  socket.on('placeBet', (lobbyId, userId, betAmount) => {
    const lobby = lobbies[lobbyId];
    const player = lobby.players.find(player => player.id === userId);
    if (player && player.balance >= betAmount) {
      player.bet = betAmount;
      player.balance -= betAmount;
      io.to(lobbyId).emit('updatePlayer', player);
      io.to(lobbyId).emit('updateLobby', lobby.players);
    } else {
      socket.emit('insufficientBalance', userId);
    }
  });

  socket.on('ready', (lobbyId, userId) => {
    const lobby = lobbies[lobbyId];
    const player = lobby.players.find(player => player.id === userId);
    if (player) {
      player.ready = true;
      io.to(lobbyId).emit('updateLobby', lobby.players);
      if (lobby.players.length >= 2 && lobby.players.every(player => player.ready)) {
        startGame(lobbyId);
      }
    }
  });

  socket.on('hit', (lobbyId, userId) => {
    const lobby = lobbies[lobbyId];
    const player = lobby.players[lobby.currentPlayerIndex];
    if (player.id === userId && !player.finished) {
      const card = dealCard(lobby.deck);
      if (card !== undefined) {
        player.hand.push(card);
        const handValue = calculateHandValue(player.hand);
        if (handValue > 21) {
          player.finished = true;
          player.result = 'lose';
        }
        io.to(lobbyId).emit('updatePlayer', player);
        io.to(lobbyId).emit('updateLobby', lobby.players);
        if (player.finished || handValue > 21) {
          lobby.currentPlayerIndex++;
          if (lobby.currentPlayerIndex >= lobby.players.length) {
            dealerTurn(lobbyId);
          } else {
            io.to(lobbyId).emit('nextPlayer', lobby.players[lobby.currentPlayerIndex].id);
          }
        }
      }
    }
  });

  socket.on('stand', (lobbyId, userId) => {
    const lobby = lobbies[lobbyId];
    const player = lobby.players[lobby.currentPlayerIndex];
    if (player.id === userId && !player.finished) {
      player.finished = true;
      io.to(lobbyId).emit('updatePlayer', player);
      io.to(lobbyId).emit('updateLobby', lobby.players);
      lobby.currentPlayerIndex++;
      if (lobby.currentPlayerIndex >= lobby.players.length) {
        dealerTurn(lobbyId);
      } else {
        io.to(lobbyId).emit('nextPlayer', lobby.players[lobby.currentPlayerIndex].id);
      }
    }
  });

  socket.on('restartGame', (lobbyId) => {
    const lobby = lobbies[lobbyId];
    lobby.players.forEach(player => {
      player.hand = [];
      player.finished = false;
      player.ready = false;
      player.blackjack = false;
      player.result = null;
      player.bet = 0;
    });
    lobby.dealer.hand = [];
    lobby.dealer.finished = false;
    lobby.deck = createDeck();
    lobby.currentPlayerIndex = 0;
    lobby.gameStarted = false;

    io.to(lobbyId).emit('updateLobby', lobby.players);
    io.to(lobbyId).emit('gameRestarted', lobby);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
    for (let lobbyId in lobbies) {
      const playerIndex = lobbies[lobbyId].players.findIndex(player => player.id === socket.id);
      if (playerIndex !== -1) {
        lobbies[lobbyId].players.splice(playerIndex, 1);
        if (lobbies[lobbyId].players.length === 0) {
          delete lobbies[lobbyId];
        } else {
          io.to(lobbyId).emit('updateLobby', lobbies[lobbyId].players);
        }
        break;
      }
    }
  });
});

server.listen(3000, () => {
  console.log('Server is running on port 3000');
});
