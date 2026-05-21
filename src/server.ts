import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import {join} from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

app.use(express.json());

// ============================================================================
// BRA SELLER: DATA STRUCTURES & DATA GENERATOR
// ============================================================================

interface OrderItem {
  name: string;
  qty: number;
  unit_price: number;
}

interface Order {
  order_id: string;
  platform: 'ml' | 'shopee' | 'amazon' | 'manual';
  date: string;
  gross_value: number;
  platform_fee: number;
  net_value: number;
  payment_method: string;
  payment_date: string;
  release_date: string;
  status: 'paid' | 'pending' | 'cancelled';
  buyer_name: string;
  items: OrderItem[];
  invoice_number: string;
}

interface Tenant {
  id: string;
  name: string;
  sellerName: string;
  email: string;
  password?: string;
  role: 'seller' | 'accountant' | 'seller_sec';
  plan: string;
  trialDaysLeft: number;
  mlConnected: boolean;
  shopeeConnected: boolean;
  amazonConnected: boolean;
}

// Global In-Memory Multi-tenant state and database of registered users
const tenantsDb: Tenant[] = [
  {
    id: 'tenant-123',
    name: 'Brás E-commerce Limitada',
    sellerName: 'Silvio E-commerce Ltda',
    email: 'thousandtws@gmail.com',
    password: 'password123',
    role: 'seller', // 'seller' (Vendedor), 'accountant' (Contador), 'seller_sec' (Vendedor Secundário)
    plan: 'Pro', // 'Básico' | 'Pro' | 'Agência'
    trialDaysLeft: 12,
    mlConnected: true,
    shopeeConnected: false,
    amazonConnected: false,
  }
];

let currentTenant: Tenant = tenantsDb[0];

// Generate highly realistic Sales Order data dating from 2026-01-01 to 2026-05-21
function generateMockOrders(): Order[] {
  const platforms: ('ml' | 'shopee' | 'amazon')[] = ['ml', 'shopee', 'amazon'];
  const pMethods = ['Cartão de Crédito', 'PIX', 'PIX', 'Boleto'];
  const buyers = [
    'Ana Souza', 'Bruno Alves', 'Carlos Ferreira', 'Daniela Silva', 
    'Eduardo Ramos', 'Fernanda Lima', 'Gabriel Santos', 'Helena Costa', 
    'Igor Oliveira', 'Julia Pinheiro', 'Lucas Rocha', 'Mariana Neves'
  ];
  const products = {
    ml: [
      { name: 'Kit 3 Camisetas Algodão Premium', price: 119.90, feePct: 0.165 },
      { name: 'Calça Cargo Sarja Slim Fit', price: 149.90, feePct: 0.165 },
      { name: 'Jaqueta Corta Vento Impermeável', price: 189.90, feePct: 0.165 },
      { name: 'Meias Esportivas Cano Alto Embalagem 6', price: 45.00, feePct: 0.12 }
    ],
    shopee: [
      { name: 'Fone Bluetooth Sem Fio AirPro', price: 79.90, feePct: 0.20 },
      { name: 'Relógio Digital Esportivo SportFit', price: 99.00, feePct: 0.20 },
      { name: 'Umidificador Difusor Aromaterapia Ultrassônico', price: 59.90, feePct: 0.18 },
      { name: 'Suporte de Celular Inteligente para Carro', price: 29.90, feePct: 0.18 }
    ],
    amazon: [
      { name: 'Livro: Do Mil ao Milhão (Thiago Nigro)', price: 34.90, feePct: 0.15 },
      { name: 'Cafeteira Elétrica Programável 1.5L', price: 289.00, feePct: 0.15 },
      { name: 'Garrafa Térmica Aço Inox 1L Stella', price: 129.90, feePct: 0.15 },
      { name: 'Mouse Sem Fio Ergonômico Recarregável', price: 89.90, feePct: 0.15 }
    ]
  };

  const orders: Order[] = [];
  
  // Deterministic generator using simple LCG for seeding (always gives same rich data)
  let seed = 42;
  function random() {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  }

  // Create ~75 orders distributed across Jan to May 2026
  const startDate = new Date('2026-01-01T08:00:00Z').getTime();
  const endDate = new Date('2026-05-21T16:00:00Z').getTime();
  
  for (let i = 0; i < 75; i++) {
    const platform = platforms[Math.floor(random() * platforms.length)];
    const datePct = i / 75; // distribute over time
    const timestamp = startDate + datePct * (endDate - startDate);
    const orderDate = new Date(timestamp);
    
    // Pick product
    const plist = products[platform];
    const prod = plist[Math.floor(random() * plist.length)];
    const qty = random() < 0.15 ? 2 : 1;
    const gross_value = Number((prod.price * qty).toFixed(2));
    const platform_fee = Number((gross_value * prod.feePct + 5.0).toFixed(2)); // flat + pct fee representational
    const net_value = Number((gross_value - platform_fee).toFixed(2));
    
    const pMethod = pMethods[Math.floor(random() * pMethods.length)];
    const buyer_name = buyers[Math.floor(random() * buyers.length)];
    
    // Status distribution
    let status: 'paid' | 'pending' | 'cancelled' = 'paid';
    const rStatus = random();
    if (rStatus < 0.08) {
      status = 'cancelled';
    } else if (rStatus < 0.2) {
      status = 'pending';
    }
    
    const payDate = status === 'paid' ? orderDate.toISOString() : '';
    const releaseDate = status === 'paid' 
      ? new Date(orderDate.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString() 
      : '';
      
    orders.push({
      order_id: `${platform.toUpperCase()}-${100000 + i}`,
      platform,
      date: orderDate.toISOString(),
      gross_value,
      platform_fee,
      net_value: status === 'cancelled' ? 0 : net_value,
      payment_method: pMethod,
      payment_date: payDate,
      release_date: releaseDate,
      status,
      buyer_name,
      items: [{
        name: prod.name,
        qty,
        unit_price: prod.price
      }],
      invoice_number: status === 'paid' ? `NF-${2026000 + i}` : ''
    });
  }
  
  // Sort by date descending
  return orders.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

const mockOrdersDatabase = generateMockOrders();

// In-memory notifications list
let mNotifications = [
  { id: 'n1', title: 'Integração Mercado Livre Ativa', message: 'Módulo de conector sincronizado perfeitamente com a API oficial do Mercado Livre.', type: 'success', date: '2026-05-21T10:00:00Z', read: false },
  { id: 'n2', title: 'Valores prestes a liberar', message: 'R$ 1.420,00 da plataforma Mercado Livre serão liberados em 48h.', type: 'info', date: '2026-05-20T14:30:00Z', read: false },
  { id: 'n3', title: 'Revisão Contábil Necessária', message: 'Relatório consolidado de Abril está pronto para exportação e envio ao contador.', type: 'warning', date: '2026-05-18T09:00:00Z', read: false },
];

// ============================================================================
// COMPATIBLE LAZY-LOADED GEMINI API SDK INTEGRATION
// ============================================================================
import { GoogleGenAI } from '@google/genai';

let cachedAiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI | null {
  if (cachedAiClient) return cachedAiClient;
  const apiKey = process.env['GEMINI_API_KEY'];
  if (apiKey && apiKey !== 'MY_GEMINI_API_KEY' && apiKey.trim() !== '') {
    try {
      cachedAiClient = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
      return cachedAiClient;
    } catch (e) {
      console.error('Falha ao inicializar o cliente GoogleGenAI:', e);
    }
  }
  return null;
}

// ============================================================================
// BRA SELLER SaaS ENDPOINTS
// ============================================================================

// A. AUTENTICAÇÃO, TENANT & PERMISSÕES
app.get('/api/auth/me', (req, res) => {
  if (!currentTenant) {
    res.status(401).json({ error: 'Nenhum usuário autenticado.' });
    return;
  }
  res.json(currentTenant);
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
    return;
  }

  const found = tenantsDb.find(t => t.email.toLowerCase() === email.toLowerCase());
  if (!found || found.password !== password) {
    res.status(401).json({ error: 'E-mail ou senha incorretos. Verifique e tente novamente.' });
    return;
  }

  currentTenant = found;
  res.json({ success: true, user: currentTenant });
});

app.post('/api/auth/register', (req, res) => {
  const { name, sellerName, email, password } = req.body;
  if (!name || !sellerName || !email || !password) {
    res.status(400).json({ error: 'Todos os campos são obrigatórios para a criação de conta.' });
    return;
  }

  const exists = tenantsDb.some(t => t.email.toLowerCase() === email.toLowerCase());
  if (exists) {
    res.status(400).json({ error: 'Este endereço de e-mail já está sendo utilizado.' });
    return;
  }

  const newTenant: Tenant = {
    id: `tenant-${Date.now()}`,
    name,
    sellerName,
    email,
    password,
    role: 'seller',
    plan: 'Básico',
    trialDaysLeft: 14,
    mlConnected: false,
    shopeeConnected: false,
    amazonConnected: false
  };

  tenantsDb.push(newTenant);
  currentTenant = newTenant;

  // Pre-seed some default orders for the newly registered user so they see a live, reactive interface immediately!
  const preSeedBuyerNames = ['Guilherme Rossi', 'Vitória Andrade', 'Felipe Santos', 'Mariana Custódio'];
  const newOrdersSeed: Order[] = [
    {
      order_id: `ML-${Math.floor(100000 + Math.random() * 900000)}`,
      platform: 'ml',
      date: new Date(Date.now() - 3 * 60 * 1000).toISOString(), // 3 mins ago
      gross_value: 149.90,
      platform_fee: 29.73,
      net_value: 120.17,
      payment_method: 'PIX',
      payment_date: new Date().toISOString(),
      release_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'paid',
      buyer_name: preSeedBuyerNames[0],
      items: [{ name: 'Calça Cargo Sarja Slim Fit', qty: 1, unit_price: 149.90 }],
      invoice_number: `NF-${Math.floor(2026000 + Math.random() * 99999)}`
    },
    {
      order_id: `SHOPEE-${Math.floor(100000 + Math.random() * 900000)}`,
      platform: 'shopee',
      date: new Date(Date.now() - 40 * 60 * 1000).toISOString(), // 40 mins ago
      gross_value: 79.90,
      platform_fee: 19.38,
      net_value: 60.52,
      payment_method: 'Cartão de Crédito',
      payment_date: new Date().toISOString(),
      release_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'paid',
      buyer_name: preSeedBuyerNames[1],
      items: [{ name: 'Fone Bluetooth Sem Fio AirPro', qty: 1, unit_price: 79.90 }],
      invoice_number: `NF-${Math.floor(2026000 + Math.random() * 99999)}`
    }
  ];

  newOrdersSeed.forEach(o => mockOrdersDatabase.unshift(o));

  res.json({ success: true, user: currentTenant });
});

app.post('/api/auth/logout', (req, res) => {
  currentTenant = null as unknown as Tenant;
  res.json({ success: true });
});

app.post('/api/auth/switch-role', (req, res) => {
  if (!currentTenant) {
    res.status(401).json({ error: 'Nenhum usuário autenticado.' });
    return;
  }
  const { role } = req.body;
  if (['seller', 'accountant', 'seller_sec'].includes(role)) {
    currentTenant.role = role;
    res.json({ success: true, user: currentTenant });
  } else {
    res.status(400).json({ error: 'Função de acesso inválida.' });
  }
});

// Middleware to guard secured API endpoints
app.use('/api', (req, res, next) => {
  // Allow login/register and get/set active tenant endpoints without guard
  if (req.path === '/auth/login' || req.path === '/auth/register' || req.path === '/auth/me') {
    return next();
  }
  if (!currentTenant) {
    res.status(401).json({ error: 'Nenhum tenant ativo. Realize login para prosseguir.' });
    return;
  }
  next();
});

// B. GESTÃO DOS CONECTORES
app.get('/api/connectors', (req, res) => {
  res.json([
    { key: 'ml', name: 'Mercado Livre', active: currentTenant.mlConnected, version: '1.2-stable', description: 'MVP ativo. Sincronização e Webhook de vendas em tempo real.', type: 'MVP - Fase 1' },
    { key: 'shopee', name: 'Shopee', active: currentTenant.shopeeConnected, version: '1.0-beta', description: 'Camada de conector pronta para acoplamento.', type: 'Fase 2' },
    { key: 'amazon', name: 'Amazon', active: currentTenant.amazonConnected, version: '0.9-alpha', description: 'Contrato de interface homologado.', type: 'Fase 3' },
  ]);
});

app.post('/api/connectors/toggle', (req, res) => {
  const { key, active } = req.body;
  if (key === 'ml') {
    currentTenant.mlConnected = active;
  } else if (key === 'shopee') {
    currentTenant.shopeeConnected = active;
  } else if (key === 'amazon') {
    currentTenant.amazonConnected = active;
  }
  res.json({ success: true, connectors: [
    { key: 'ml', name: 'Mercado Livre', active: currentTenant.mlConnected },
    { key: 'shopee', name: 'Shopee', active: currentTenant.shopeeConnected },
    { key: 'amazon', name: 'Amazon', active: currentTenant.amazonConnected },
  ]});
});

// C. PEDIDOS & FILTROS (Core query engine)
app.get('/api/orders', (req, res) => {
  const { platform, status, search, limit } = req.query;
  const activePlatforms = ['manual'];
  if (currentTenant.mlConnected) activePlatforms.push('ml');
  if (currentTenant.shopeeConnected) activePlatforms.push('shopee');
  if (currentTenant.amazonConnected) activePlatforms.push('amazon');

  let filtered = mockOrdersDatabase.filter(o => activePlatforms.includes(o.platform));
  
  if (platform && platform !== 'all') {
    filtered = filtered.filter(o => o.platform === platform);
  }
  
  if (status && status !== 'all') {
    filtered = filtered.filter(o => o.status === status);
  }
  
  if (search) {
    const q = String(search).toLowerCase();
    filtered = filtered.filter(o => 
      o.order_id.toLowerCase().includes(q) || 
      o.buyer_name.toLowerCase().includes(q) || 
      o.items.some(i => i.name.toLowerCase().includes(q)) ||
      (o.invoice_number && o.invoice_number.toLowerCase().includes(q))
    );
  }
  
  const l = limit ? parseInt(String(limit), 10) : 50;
  res.json(filtered.slice(0, l));
});

// C2. CRIAR LANÇAMENTO MANUAL
app.post('/api/orders', (req, res) => {
  if (currentTenant.role === 'accountant') {
    res.status(403).json({ error: 'Acesso somente leitura para contador.' });
    return;
  }
  const { buyer_name, item_name, qty, unit_price, platform_fee, payment_method, status, invoice_number } = req.body;
  const finalQty = Number(qty || 1);
  const finalPrice = Number(unit_price || 0);
  const gross = Number((finalQty * finalPrice).toFixed(2));
  const fee = Number(Number(platform_fee || 0).toFixed(2));
  const net = Number((gross - fee).toFixed(2));
  
  const newOrder: Order = {
    order_id: `MAN-${100000 + mockOrdersDatabase.length}`,
    platform: 'manual',
    date: new Date().toISOString(),
    gross_value: gross,
    platform_fee: fee,
    net_value: status === 'cancelled' ? 0 : net,
    payment_method: payment_method || 'PIX',
    payment_date: status === 'paid' ? new Date().toISOString() : '',
    release_date: status === 'paid' ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString() : '',
    status: status || 'paid',
    buyer_name: buyer_name || 'Comprador Indefinido',
    items: [{
      name: item_name || 'Item Manual',
      qty: finalQty,
      unit_price: finalPrice
    }],
    invoice_number: invoice_number || `NF-M${2026000 + mockOrdersDatabase.length}`
  };
  
  mockOrdersDatabase.unshift(newOrder); // Add to beginning of database
  res.json({ success: true, order: newOrder });
});

// C3. SINCRONIZAR CONECTORES ATIVOS EM TEMPO REAL
app.post('/api/connectors/sync', (req, res) => {
  if (currentTenant.role === 'accountant') {
    res.status(403).json({ error: 'Contador não possui permissão para sincronizar canais operacionais.' });
    return;
  }
  
  // Simulate syncing: determine which platforms are active
  const activePlatforms: ('ml' | 'shopee' | 'amazon')[] = [];
  if (currentTenant.mlConnected) activePlatforms.push('ml');
  if (currentTenant.shopeeConnected) activePlatforms.push('shopee');
  if (currentTenant.amazonConnected) activePlatforms.push('amazon');
  
  if (activePlatforms.length === 0) {
    res.json({ success: false, message: 'Nenhum conector acoplado no momento. Acople um canal na aba de Módulos primeiro!' });
    return;
  }
  
  // Create simulated orders
  const syncBuyers = ['Vanessa Dias', 'Patrícia Prado', 'Rodrigo Mendes', 'Alice Neves', 'Thales Ramos', 'Carolina Gouveia'];
  const syncProducts = {
    ml: { name: 'Sapato Social Italiano Couro Legítimo', price: 249.90, feePct: 0.165 },
    shopee: { name: 'Mochila Impermeável Escolar Reforçada', price: 119.00, feePct: 0.20 },
    amazon: { name: 'Teclado Mecânico Gamer RGB Silent', price: 419.00, feePct: 0.15 }
  };
  
  const addedList: Order[] = [];
  
  activePlatforms.forEach((plat) => {
    const prod = syncProducts[plat];
    const gross = prod.price;
    const fee = Number((gross * prod.feePct + 5.0).toFixed(2));
    const net = Number((gross - fee).toFixed(2));
    const randomId = Math.floor(100000 + Math.random() * 900000);
    
    const newOrd: Order = {
      order_id: `${plat.toUpperCase()}-${randomId}`,
      platform: plat,
      date: new Date().toISOString(),
      gross_value: gross,
      platform_fee: fee,
      net_value: net,
      payment_method: 'PIX',
      payment_date: new Date().toISOString(),
      release_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'paid',
      buyer_name: syncBuyers[Math.floor(Math.random() * syncBuyers.length)],
      items: [{
        name: prod.name,
        qty: 1,
        unit_price: prod.price
      }],
      invoice_number: `NF-${Math.floor(2026000 + Math.random() * 99999)}`
    };
    
    mockOrdersDatabase.unshift(newOrd);
    addedList.push(newOrd);
  });
  
  // Also push a notification in-memory so the notifications dropdown alerts the client!
  const syncNotifId = 'n_sync_' + Date.now();
  mNotifications.unshift({
    id: syncNotifId,
    title: 'Sincronização Modular Concluída',
    message: `Sucesso! Sincronizado com ${activePlatforms.map(p => p.toUpperCase()).join(', ')}. +${addedList.length} novos lançamentos inseridos de forma assíncrona.`,
    type: 'success',
    date: new Date().toISOString(),
    read: false
  });
  
  res.json({
    success: true,
    addedCount: addedList.length,
    added: addedList,
    notifications: mNotifications
  });
});

// D. DASHBOARD METRICS SUMMARY (Multi-tenant unified panel)
app.get('/api/summary', (req, res) => {
  const activePlatforms = ['ml'];
  if (currentTenant.shopeeConnected) activePlatforms.push('shopee');
  if (currentTenant.amazonConnected) activePlatforms.push('amazon');

  const visibleOrders = mockOrdersDatabase.filter(o => activePlatforms.includes(o.platform));
  
  let gross_value = 0;
  let platform_fee = 0;
  let net_value = 0;
  let pending_value = 0;
  let total_orders = 0;
  let paid_orders_count = 0;
  
  visibleOrders.forEach(o => {
    total_orders++;
    if (o.status === 'paid') {
      paid_orders_count++;
      gross_value += o.gross_value;
      platform_fee += o.platform_fee;
      net_value += o.net_value;
    } else if (o.status === 'pending') {
      pending_value += o.gross_value;
    }
  });

  const platformSplit: Record<string, number> = { ml: 0, shopee: 0, amazon: 0 };
  visibleOrders.filter(o => o.status === 'paid').forEach(o => {
    platformSplit[o.platform] = (platformSplit[o.platform] || 0) + o.gross_value;
  });

  res.json({
    gross_value: Number(gross_value.toFixed(2)),
    platform_fee: Number(platform_fee.toFixed(2)),
    net_value: Number(net_value.toFixed(2)),
    pending_value: Number(pending_value.toFixed(2)),
    total_orders,
    paid_orders_count,
    average_ticket: paid_orders_count > 0 ? Number((gross_value / paid_orders_count).toFixed(2)) : 0,
    platform_split: platformSplit,
    currency: 'BRL',
    active_integrations: activePlatforms
  });
});

// E. EXPORT SYSTEM (PDF, EXCEL, CSV download nodes)
app.get('/api/export/csv', (req, res) => {
  const activePlatforms = ['ml'];
  if (currentTenant.shopeeConnected) activePlatforms.push('shopee');
  if (currentTenant.amazonConnected) activePlatforms.push('amazon');
  const visibleOrders = mockOrdersDatabase.filter(o => activePlatforms.includes(o.platform));

  let csvContent = 'ID Pedido,Plataforma,Data,Comprador,Item,Qtd,Valor Bruto (R$),Taxa Cobrada (R$),Valor Liquido (R$),Forma de Pagamento,Status,Chave Nota Fiscal\n';
  
  visibleOrders.forEach(o => {
    const itemName = o.items[0]?.name.replace(/,/g, ' ') || '';
    csvContent += `"${o.order_id}","${o.platform.toUpperCase()}","${o.date.split('T')[0]}","${o.buyer_name}","${itemName}",${o.items[0]?.qty || 1},${o.gross_value},${o.platform_fee},${o.net_value},"${o.payment_method}","${o.status}","${o.invoice_number || ''}"\n`;
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=relatorio-vendas-braseller.csv');
  res.send(Buffer.from('\uFEFF' + csvContent, 'utf-8'));
});

app.get('/api/export/excel', (req, res) => {
  const activePlatforms = ['ml'];
  if (currentTenant.shopeeConnected) activePlatforms.push('shopee');
  if (currentTenant.amazonConnected) activePlatforms.push('amazon');
  const visibleOrders = mockOrdersDatabase.filter(o => activePlatforms.includes(o.platform));

  let htmlTable = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8"/><style>table { border-collapse: collapse; } th { background-color: #0052ff; color: white; padding: 6px; } td { padding: 4px; border: 1px solid #eef0f3; }</style></head>
    <body>
      <h2>Relatório Consolidado de Vendas - BraSeller</h2>
      <p>Gerado em: ${new Date().toLocaleDateString('pt-BR')}</p>
      <table>
        <thead>
          <tr>
            <th>ID Pedido</th>
            <th>Marketplace</th>
            <th>Data</th>
            <th>Comprador</th>
            <th>Produto</th>
            <th>Qtd</th>
            <th>Valor Bruto (R$)</th>
            <th>Taxas (R$)</th>
            <th>Valor Líquido (R$)</th>
            <th>Pagamento</th>
            <th>Status</th>
            <th>NF-e</th>
          </tr>
        </thead>
        <tbody>
  `;

  visibleOrders.forEach(o => {
    htmlTable += `
      <tr>
        <td>${o.order_id}</td>
        <td><b>${o.platform.toUpperCase()}</b></td>
        <td>${o.date.split('T')[0]}</td>
        <td>${o.buyer_name}</td>
        <td>${o.items[0]?.name || ''}</td>
        <td>${o.items[0]?.qty || 1}</td>
        <td>${o.gross_value.toFixed(2)}</td>
        <td>${o.platform_fee.toFixed(2)}</td>
        <td>${o.net_value.toFixed(2)}</td>
        <td>${o.payment_method}</td>
        <td>${o.status.toUpperCase()}</td>
        <td>${o.invoice_number || '-'}</td>
      </tr>
    `;
  });

  htmlTable += `
        </tbody>
      </table>
    </body>
    </html>
  `;

  res.setHeader('Content-Type', 'application/vnd.ms-excel');
  res.setHeader('Content-Disposition', 'attachment; filename=relatorio-vendas-braseller.xls');
  res.send(htmlTable);
});

app.get('/api/export/pdf', (req, res) => {
  const activePlatforms = ['ml'];
  if (currentTenant.shopeeConnected) activePlatforms.push('shopee');
  if (currentTenant.amazonConnected) activePlatforms.push('amazon');
  const visibleOrders = mockOrdersDatabase.filter(o => activePlatforms.includes(o.platform));
  
  let totalGross = 0;
  let totalFees = 0;
  let totalNet = 0;
  
  visibleOrders.forEach(o => {
    if (o.status === 'paid') {
      totalGross += o.gross_value;
      totalFees += o.platform_fee;
      totalNet += o.net_value;
    }
  });

  const reportHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Relatório Contábil BraSeller</title>
      <style>
        body { font-family: 'Helvetica Neue', Arial, sans-serif; padding: 40px; color: #0a0b0d; background-color: white; }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0052ff; padding-bottom: 20px; margin-bottom: 30px; }
        .title { font-size: 24px; font-weight: bold; }
        .meta { text-align: right; font-size: 14px; color: #5b616e; }
        .metrics { display: flex; gap: 20px; margin-bottom: 30px; }
        .card { flex: 1; padding: 20px; background-color: #f7f7f7; border-radius: 8px; border: 1px solid #dee1e6; }
        .card h4 { margin: 0 0 10px 0; color: #5b616e; font-size: 14px; text-transform: uppercase; }
        .card .value { font-size: 22px; font-family: monospace; font-weight: bold; color: #0052ff; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
        th { background-color: #eef0f3; color: #0a0b0d; text-align: left; padding: 10px; border-bottom: 2px solid #dee1e6; }
        td { padding: 10px; border-bottom: 1px solid #eef0f3; }
        .cancelled { color: #cf202f; }
        .footer { text-align: center; margin-top: 40px; font-size: 12px; color: #7c828a; border-top: 1px solid #dee1e6; padding-top: 20px; }
        @media print {
          body { padding: 0; }
          .no-print { display: none; }
        }
      </style>
    </head>
    <body onload="window.print()">
      <div class="no-print" style="margin-bottom: 15px; background: #eef0f3; padding: 10px; border-radius: 6px; font-size: 13px;">
        Esta página abriu a caixa de impressão automática. Se necessário, selecione "Salvar como PDF" no destino da sua impressora.
      </div>
      <div class="header">
        <div>
          <div class="title">BraSeller · Relatório do Contador</div>
          <div style="font-size: 14px; color: #5b616e; margin-top: 5px;">Tenant: ${currentTenant.sellerName} (${currentTenant.email})</div>
        </div>
        <div class="meta">
          <div><b>Data de Emissão:</b> ${new Date().toLocaleDateString('pt-BR')}</div>
          <div><b>Período:</b> Quadrimestre Consolidado 2026</div>
        </div>
      </div>

      <div class="metrics">
        <div class="card">
          <h4>Faturamento Bruto</h4>
          <div class="value">R$ ${totalGross.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
        </div>
        <div class="card">
          <h4>Taxas de Intermediação</h4>
          <div class="value" style="color: #cf202f;">R$ ${totalFees.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
        </div>
        <div class="card">
          <h4>Faturamento Líquido</h4>
          <div class="value" style="color: #05b169;">R$ ${totalNet.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
        </div>
      </div>

      <h3>Lançamentos Detalhados</h3>
      <table>
        <thead>
          <tr>
            <th>ID Pedido</th>
            <th>Marketplace</th>
            <th>Data</th>
            <th>Comprador</th>
            <th>Valor Bruto</th>
            <th>Taxas</th>
            <th>Líquido</th>
            <th>Status</th>
            <th>NF-e</th>
          </tr>
        </thead>
        <tbody>
          ${visibleOrders.map(o => `
            <tr class="${o.status === 'cancelled' ? 'cancelled' : ''}">
              <td>${o.order_id}</td>
              <td><b>${o.platform.toUpperCase()}</b></td>
              <td>${o.date.split('T')[0]}</td>
              <td>${o.buyer_name}</td>
              <td>R$ ${o.gross_value.toFixed(2)}</td>
              <td>R$ ${o.platform_fee.toFixed(2)}</td>
              <td>R$ ${o.net_value.toFixed(2)}</td>
              <td>${o.status.toUpperCase()}</td>
              <td>${o.invoice_number || 'Sem NF'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="footer">
        Documento gerado automaticamente pelo núcleo tecnológico BraSeller SaaS. Integrado via conector unificado. © 2026 BraSeller
      </div>
    </body>
    </html>
  `;
  res.send(reportHtml);
});

// F. NOTIFICAÇÕES & ALERTA CONTROLLER
app.get('/api/notifications', (req, res) => {
  res.json(mNotifications);
});

app.post('/api/notifications/read', (req, res) => {
  const { id } = req.body;
  mNotifications = mNotifications.map(n => n.id === id ? { ...n, read: true } : n);
  res.json({ success: true, notifications: mNotifications });
});

app.post('/api/notifications/clear', (req, res) => {
  mNotifications = [];
  res.json({ success: true, notifications: mNotifications });
});

// G. BILLING E ASSINATURAS
app.post('/api/billing/upgrade', (req, res) => {
  const { plan } = req.body;
  if (['Básico', 'Pro', 'Agência'].includes(plan)) {
    currentTenant.plan = plan;
    currentTenant.trialDaysLeft = 0;
    res.json({ success: true, plan, user: currentTenant });
  } else {
    res.status(400).json({ error: 'Plano inválido' });
  }
});

// H. INTEGRAÇÃO COM SERVENTIA DE INTELIGÊNCIA ARTIFICIAL (GEMINI CLIENTE SERVIDOR)
app.post('/api/gemini/chat', async (req, res) => {
  const { message } = req.body;
  
  if (!message || message.trim() === '') {
    res.status(400).json({ response: 'Mensagem vazia recebida.' });
    return;
  }

  const summaryData = {
    gross: 0, fees: 0, net: 0, ordersCount: 0, activePlatforms: ['Mercado Livre (Ativo)']
  };
  if (currentTenant.shopeeConnected) summaryData.activePlatforms.push('Shopee (Ativo)');
  if (currentTenant.amazonConnected) summaryData.activePlatforms.push('Amazon (Ativo)');
  
  mockOrdersDatabase.forEach(o => {
    if (o.status === 'paid') {
      summaryData.gross += o.gross_value;
      summaryData.fees += o.platform_fee;
      summaryData.net += o.net_value;
      summaryData.ordersCount++;
    }
  });

  const contextSystemPrompts = `
    Você é a Inteligência Analítica Integrada do BraSeller (versão 1.0), uma plataforma SaaS inovadora de gestão de vendas para e-commerce em ambiente modular.
    O sistema possui uma arquitetura única: um Core central compartilhado que nunca é alterado, e conectores independentes acopláveis para e-commerce (Mercado Livre, Shopee, Amazon).
    Atualmente o usuário ativo é: Silvio E-commerce (silvio@braseller.com), no papel de: ${currentTenant.role === 'seller' ? 'Vendedor Principal (Venda e Gestão)' : currentTenant.role === 'accountant' ? 'Contador Externo (Acesso somente leitura de fechamento)' : 'Vendedor Secundário (Limitado)'}.
    
    ESTATÍSTICAS ATUAIS DO USUÁRIO (Jan-Maio 2026):
    - Faturamento Bruto total: R$ ${summaryData.gross.toFixed(2)}
    - Comissões e Taxas pagas: R$ ${summaryData.fees.toFixed(2)} (${((summaryData.fees / summaryData.gross) * 100).toFixed(1)}% do faturamento)
    - Receita Líquida real: R$ ${summaryData.net.toFixed(2)}
    - Quantidade de pedidos fechados e pagos: ${summaryData.ordersCount}
    - Ticket Médio por transação: R$ ${(summaryData.gross / summaryData.ordersCount).toFixed(2)}
    - Integrações configuradas: ${summaryData.activePlatforms.join(', ')}
    
    DETALHES DE TAXAS POR CONECTOR:
    - Mercado Livre: 16.5% + R$ 6.00 fixo por item vendido.
    - Shopee: 20% com limite máximo de intermediação.
    - Amazon: 15% tabelado por categoria.

    ROLE PERMISSIONS ADVICE:
    - Se a conta logada for 'Contador', destaque os fechamentos e exportações contábeis.
    - Se for 'Vendedor', dê conselhos operacionais sobre otimização de margens de lucro.

    IMPORTANTE: Responda em português (do Brasil). Seja extremamente corporativo, minimalista e focado em dados concretos. Utilize tabelas Markdown e listas para exibir faturamentos se necessário. Evite jargões ou explicações redundantes sobre o que é IA. Forneça respostas diretas e úteis para quem está gerindo o negócio.
  `;

  const client = getGeminiClient();
  
  if (client) {
    try {
      const response = await client.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: [
          { role: 'user', parts: [{ text: `${contextSystemPrompts}\n\nPergunta do usuário:\n${message}` }] }
        ],
        config: {
          temperature: 0.7,
        }
      });
      
      const reply = response.text || 'Desculpe, não consegui obter uma resposta.';
      res.json({ response: reply, isReal: true });
      return;
    } catch (err: unknown) {
      console.error('Falha na chamada do Gemini API:', err);
    }
  }

  setTimeout(() => {
    let reply = '';
    const query = message.toLowerCase();
    
    if (query.includes('taxa') || query.includes('meli') || query.includes('mercado livre') || query.includes('shopee') || query.includes('amazon')) {
      reply = `### Análise Comparativa de Taxas de Intermediação

Com base na sua base de dados atual de **${summaryData.ordersCount} pedidos**, as taxas cobradas pelas plataformas representam uma fatia significativa do seu faturamento bruto.

| Plataforma | Transações | Faturamento Bruto | Taxas Totais | Percentual Real |
| :--- | :---: | :---: | :---: | :---: |
| **Mercado Livre** | 25 | R$ ${(summaryData.gross * 0.45).toFixed(2)} | R$ ${(summaryData.fees * 0.43).toFixed(2)} | 16.5% + R$5 |
| **Shopee** | 25 | R$ ${(summaryData.gross * 0.33).toFixed(2)} | R$ ${(summaryData.fees * 0.35).toFixed(2)} | 20.0% regulado |
| **Amazon** | 25 | R$ ${(summaryData.gross * 0.22).toFixed(2)} | R$ ${(summaryData.fees * 0.22).toFixed(2)} | 15.0% fixo |

**Insights de Otimização:**
1. Seu canal de maior margem líquida percentual é a **Amazon** (15%), embora o volume bruto hoje esteja concentrado no **Mercado Livre**.
2. Na Shopee, as taxas de 20% limitam promoções de tíquetes mais baixos. Sugerimos focar em combos acima de R$ 79,90 para cobrir o frete subsidiado.
3. Considere reajustar em 3.2% a tabela de preços do Mercado Livre para compensar o custo fixo de R$ 6.00 por transação em itens de baixo custo.

---
*Nota: Para habilitar relatórios gerados por inteligência artificial em tempo real integrada com o modelo Gemini 3.5, defina a variável \`GEMINI_API_KEY\` na aba **Settings > Secrets** no painel do AI Studio.*`;
    } else if (query.includes('contador') || query.includes('fechamento') || query.includes('relatório')) {
      reply = `### Suporte de Fechamento Contábil Mensal

Olá, identificamos no sistema que você possui o perfil de acesso correspondente. Eu posso ajudar a separar e simplificar os demonstrativos para o seu contador.

**Resumo de Fechamento Quadrimestral (2026):**
*   **Faturamento Consolidado:** R$ ${summaryData.gross.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
*   **Deduções Totais (Tarifas de Intermediação):** R$ ${summaryData.fees.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
*   **Base Líquida Tributável:** R$ ${summaryData.net.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
*   **Emissão de Notas Fiscais (NF-e):** 100% de cobertura nos pedidos pagos com status \`paid\`.

**Instruções para Exportação Direta:**
1. Clique no botão **"Exportar PDF (Módulo Contador)"** na barra superior do Painel de Lançamentos para imprimir ou salvar em formato fiscal regulamentado.
2. Você também pode exportar em formato **Excel (.xls)** para que o contador importe em massa no sistema de escrita fiscal da empresa (\`Contmatic / Domínio\`).

*Dica de Auditoria:* Há 3 lançamentos cancelados no Mercado Livre que receberam NF-e de entrada/devolução automática. O sistema já conciliou estas baixas.`;
    } else if (query.includes('previs') || query.includes('forecasting') || query.includes('faturamento') || query.includes('futuro')) {
      reply = `### Modelo Preditivo de Faturamento (Junho 2026)

Com base na sua taxa de crescimento mensal média de **+8.4%** calculada desde Janeiro de 2026, projetamos o seguinte comportamento para a sua operação:

*   **Faturamento Estimado (Junho 2026):** R$ ${(summaryData.gross / 4.5 * 1.084).toFixed(2)}
*   **Margem Líquida Projetada:** R$ ${(summaryData.net / 4.5 * 1.084).toFixed(2)}
*   **Principais Vetores de Tração:** 
    *   Curva de faturamento ascendente no Mercado Livre impulsionada pelas categorias de vestuário.
    *   Sazonalidade favorável do dia dos namorados em Junho.

**Recomendações e Plano de Ação:**
*   Aumente em 15% o estoque dos produtos curva A para evitar rutura de estoque no estoque Full do Mercado Livre.
*   Considere habilitar o conector da **Shopee** no Painel de Modulos para capturar a campanha do canal do dia 06/06 (Campanha Relâmpago).`;
    } else {
      reply = `### Central de Apoio BraSeller Inteligência

Olá! Sou o assistente preditivo do **BraSeller Core**. Analisei a sua operação e notei que suas vendas de e-commerce estão ativas no momento.

Aqui estão algumas perguntas analíticas que posso responder para auxiliar na sua tomada de decisão estratégica:
1. **"Qual plataforma possui as maiores taxas e qual sua receita líquida?"**
2. **"Gere uma análise de fechamento para o meu contador"**
3. **"Qual a previsão de faturamento e vendas para o próximo mês?"**

Sinta-se à vontade para perguntar ou ajustar as integrações na aba superior. No BraSeller, todos os seus canais alimentam o mesmo banco centralizado instantaneamente!`;
    }
    
    res.json({ response: reply, isReal: false });
  }, 400);
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
