const { v4: uuidv4 } = require('uuid');

function getCardValue(card) {
  if (card === undefined) return 0;
  if (['J', 'Q', 'K'].includes(card.rank)) {
    return 10;
  }
  if (card.rank === 'A') {
    return 11;
  }
  return parseInt(card.rank);
}

function calculateHandValue(hand) {
  let value = 0;
  let aceCount = 0;
  hand.forEach(card => {
    value += getCardValue(card);
    if (card.rank === 'A') aceCount++;
  });
  while (value > 21 && aceCount > 0) {
    value -= 10;
    aceCount--;
  }
  return value;
}

function createDeck() {
  const suits = ['Hearts', 'Diamonds', 'Clubs', 'Spades'];
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck = [];
  suits.forEach(suit => {
    ranks.forEach(rank => {
      deck.push({ suit, rank });
    });
  });
  return deck.sort(() => Math.random() - 0.5);
}

function dealCard(deck) {
  if (deck.length === 0) {
    console.error('No more cards in the deck');
    return undefined;
  }
  return deck.pop();
}

function generatePassword() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function generateLobbyId() {
  return uuidv4();
}

module.exports = {
  getCardValue,
  calculateHandValue,
  createDeck,
  dealCard,
  generatePassword,
  generateLobbyId
};
