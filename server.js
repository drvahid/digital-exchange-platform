const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'your-secret-key-change-in-production';

// Middleware
app.use(cors());
app.use(bodyParser.json());

// In-memory database
const users = new Map();
const wallets = new Map();
const trades = [];
const withdrawLimits = new Map();
const tradingFees = new Map();

// Helper Functions
function generateUserId() {
  return 'user_' + Math.random().toString(36).substr(2, 9);
}

function generateWalletAddress() {
  return '0x' + Math.random().toString(16).substr(2, 40);
}

// Initialize sample data
function initializeData() {
  // Sample trading fees
  tradingFees.set('btc_usd', { maker: 0.1, taker: 0.15, group: 'vip' });
  tradingFees.set('eth_usd', { maker: 0.1, taker: 0.15, group: 'vip' });
  
  // Sample withdraw limits
  withdrawLimits.set('vip', { daily: 100000, monthly: 500000 });
  withdrawLimits.set('standard', { daily: 10000, monthly: 50000 });
}

// Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'No token provided' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

// ============ PUBLIC ENDPOINTS ============

// Health Check - Ready
app.get('/api/v2/peatio/public/health/ready', (req, res) => {
  res.json({ status: 'ready', timestamp: new Date() });
});

// Health Check - Alive
app.get('/api/v2/peatio/public/health/alive', (req, res) => {
  res.json({ status: 'alive', timestamp: new Date() });
});

// Version
app.get('/api/v2/peatio/public/version', (req, res) => {
  res.json({ version: '2.0.0', api_version: 'v2' });
});

// Server Timestamp
app.get('/api/v2/peatio/public/timestamp', (req, res) => {
  res.json({ timestamp: Math.floor(Date.now() / 1000) });
});

// Member Levels
app.get('/api/v2/peatio/public/member-levels', (req, res) => {
  res.json([
    { id: 1, key: 'standard', title: 'Standard' },
    { id: 2, key: 'vip', title: 'VIP' },
    { id: 3, key: 'premium', title: 'Premium' }
  ]);
});

// Withdraw Limits
app.get('/api/v2/peatio/public/withdraw_limits', (req, res) => {
  const { group, kyc_level, limit = 100, page = 1 } = req.query;
  
  const limits = Array.from(withdrawLimits.entries()).map(([key, value]) => ({
    group: key,
    ...value
  }));
  
  res.json({
    data: limits,
    pagination: { limit, page, total: limits.length }
  });
});

// Trading Fees
app.get('/api/v2/peatio/public/trading_fees', (req, res) => {
  const { group, market, limit = 100, page = 1 } = req.query;
  
  const fees = Array.from(tradingFees.entries()).map(([key, value]) => ({
    market: key,
    ...value
  }));
  
  res.json({
    data: fees,
    pagination: { limit, page, total: fees.length }
  });
});

// ============ AUTHENTICATION ENDPOINTS ============

// Register
app.post('/api/v2/auth/register', (req, res) => {
  const { email, password, username } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const userId = generateUserId();
  const user = { userId, email, username, password, group: 'standard', created_at: new Date() };
  users.set(userId, user);

  // Create default wallets
  const currencies = ['btc', 'eth', 'usd'];
  currencies.forEach(curr => {
    const walletId = `wallet_${userId}_${curr}`;
    wallets.set(walletId, {
      id: walletId,
      userId,
      currency: curr,
      balance: 0,
      address: generateWalletAddress(),
      created_at: new Date()
    });
  });

  res.status(201).json({
    success: true,
    userId,
    email,
    message: 'User registered successfully'
  });
});

// Login
app.post('/api/v2/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  let user = null;
  for (let [, u] of users) {
    if (u.email === email && u.password === password) {
      user = u;
      break;
    }
  }

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ userId: user.userId, email: user.email }, JWT_SECRET, {
    expiresIn: '24h'
  });

  res.json({
    success: true,
    token,
    user: { userId: user.userId, email: user.email, group: user.group }
  });
});

// ============ WALLET ENDPOINTS ============

// Get Wallets
app.get('/api/v2/wallet/wallets', authenticateToken, (req, res) => {
  const userWallets = Array.from(wallets.values())
    .filter(w => w.userId === req.user.userId);
  
  res.json({
    success: true,
    data: userWallets
  });
});

// Get Single Wallet
app.get('/api/v2/wallet/wallets/:currency', authenticateToken, (req, res) => {
  const { currency } = req.params;
  const walletId = `wallet_${req.user.userId}_${currency}`;
  const wallet = wallets.get(walletId);

  if (!wallet) {
    return res.status(404).json({ error: 'Wallet not found' });
  }

  res.json({ success: true, data: wallet });
});

// Deposit
app.post('/api/v2/wallet/deposit', authenticateToken, (req, res) => {
  const { currency, amount } = req.body;

  if (!currency || !amount) {
    return res.status(400).json({ error: 'Currency and amount required' });
  }

  const walletId = `wallet_${req.user.userId}_${currency}`;
  const wallet = wallets.get(walletId);

  if (!wallet) {
    return res.status(404).json({ error: 'Wallet not found' });
  }

  wallet.balance += parseFloat(amount);

  res.json({
    success: true,
    message: 'Deposit successful',
    wallet
  });
});

// Withdraw
app.post('/api/v2/wallet/withdraw', authenticateToken, (req, res) => {
  const { currency, amount, address } = req.body;

  if (!currency || !amount || !address) {
    return res.status(400).json({ error: 'Currency, amount, and address required' });
  }

  const walletId = `wallet_${req.user.userId}_${currency}`;
  const wallet = wallets.get(walletId);

  if (!wallet) {
    return res.status(404).json({ error: 'Wallet not found' });
  }

  if (wallet.balance < amount) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }

  wallet.balance -= parseFloat(amount);

  res.json({
    success: true,
    message: 'Withdrawal initiated',
    transaction_id: 'txn_' + Date.now(),
    wallet
  });
});

// ============ TRADING ENDPOINTS ============

// Create Trade
app.post('/api/v2/trading/orders', authenticateToken, (req, res) => {
  const { market, side, price, volume } = req.body;

  if (!market || !side || !price || !volume) {
    return res.status(400).json({ error: 'Market, side, price, and volume required' });
  }

  const order = {
    id: 'order_' + Date.now(),
    userId: req.user.userId,
    market,
    side,
    price: parseFloat(price),
    volume: parseFloat(volume),
    status: 'pending',
    created_at: new Date()
  };

  trades.push(order);

  res.status(201).json({
    success: true,
    message: 'Order created',
    order
  });
});

// Get Orders
app.get('/api/v2/trading/orders', authenticateToken, (req, res) => {
  const userOrders = trades.filter(t => t.userId === req.user.userId);
  
  res.json({
    success: true,
    data: userOrders,
    total: userOrders.length
  });
});

// Cancel Order
app.post('/api/v2/trading/orders/:id/cancel', authenticateToken, (req, res) => {
  const { id } = req.params;
  const order = trades.find(t => t.id === id && t.userId === req.user.userId);

  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  order.status = 'cancelled';

  res.json({
    success: true,
    message: 'Order cancelled',
    order
  });
});

// ============ WEBHOOK ENDPOINT ============

app.post('/api/v2/peatio/public/webhooks/:adapter/:event', (req, res) => {
  const { adapter, event } = req.params;
  const data = req.body;

  console.log(`Webhook received: ${adapter}/${event}`, data);

  res.json({
    success: true,
    message: 'Webhook processed',
    adapter,
    event
  });
});

// ============ ERROR HANDLING ============

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start Server
initializeData();
app.listen(PORT, () => {
  console.log(`MSAMEX Simulator running on http://localhost:${PORT}`);
  console.log(`API Base: http://localhost:${PORT}/api/v2`);
});
