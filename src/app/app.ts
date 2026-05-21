import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { CommonModule, DecimalPipe, DatePipe } from '@angular/common';

interface Tenant {
  id: string;
  name: string;
  sellerName: string;
  email: string;
  role: 'seller' | 'accountant' | 'seller_sec';
  plan: string;
  trialDaysLeft: number;
  mlConnected: boolean;
  shopeeConnected: boolean;
  amazonConnected: boolean;
}

interface Connector {
  key: string;
  name: string;
  active: boolean;
  version: string;
  description: string;
  type: string;
}

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

interface DashboardSummary {
  gross_value: number;
  platform_fee: number;
  net_value: number;
  pending_value: number;
  total_orders: number;
  paid_orders_count: number;
  average_ticket: number;
  platform_split: Record<string, number>;
  currency: string;
  active_integrations: string[];
}

interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: 'success' | 'info' | 'warning' | 'danger';
  date: string;
  read: boolean;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  date: Date;
  isReal?: boolean;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatIconModule],
  providers: [DecimalPipe, DatePipe],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private http = inject(HttpClient);
  private fb = inject(FormBuilder);

  // States
  tenant = signal<Tenant | null>(null);
  connectors = signal<Connector[]>([]);
  summary = signal<DashboardSummary | null>(null);
  orders = signal<Order[]>([]);
  notifications = signal<AppNotification[]>([]);
  selectedOrder = signal<Order | null>(null);
  isOrderModalOpen = signal<boolean>(false);
  isUpgradeModalOpen = signal<boolean>(false);
  showNotificationsMenu = signal<boolean>(false);

  // Chat State
  chatMessages = signal<ChatMessage[]>([
    {
      role: 'assistant',
      text: '### Central de Apoio BraSeller Inteligência\n\nOlá Silvio! Sou o assistente de inteligência preditiva do **BraSeller Core**. \n\nEstou conectado aos seus conectores e posso analisar taxas, previsões de faturamento ou ajudá-lo com fechamentos contábeis.\n\nClique em uma das sugestões abaixo ou digite sua dúvida no campo!',
      date: new Date(),
    }
  ]);
  chatLoading = signal<boolean>(false);

  // Suggested Prompts
  suggestions = [
    'Qual plataforma possui as maiores taxas e qual sua receita líquida?',
    'Fazer fechamento para meu contador',
    'Previsão de faturamento para o próximo mês'
  ];

  // Forms
  filterForm!: FormGroup;
  chatForm!: FormGroup;
  manualForm!: FormGroup;
  loginForm!: FormGroup;
  registerForm!: FormGroup;

  // Active Tab: 'dashboard' | 'connectors' | 'orders' | 'chat'
  activeTab = signal<'dashboard' | 'connectors' | 'orders' | 'chat'>('dashboard');
  
  // Loading & Modal states
  isSyncing = signal<boolean>(false);
  isManualModalOpen = signal<boolean>(false);

  // Authentication Module Signals
  authMode = signal<'login' | 'register'>('login');
  authError = signal<string>('');
  authLoading = signal<boolean>(false);

  ngOnInit() {
    this.initForms();
    this.loadAllData();
  }

  private initForms() {
    this.filterForm = this.fb.group({
      platform: ['all'],
      status: ['all'],
      search: [''],
    });

    this.chatForm = this.fb.group({
      message: ['', [Validators.required]],
    });

    this.manualForm = this.fb.group({
      buyer_name: ['', [Validators.required, Validators.minLength(2)]],
      item_name: ['', [Validators.required]],
      qty: [1, [Validators.required, Validators.min(1)]],
      unit_price: [0, [Validators.required, Validators.min(0.01)]],
      platform_fee: [0, [Validators.required, Validators.min(0)]],
      payment_method: ['PIX', [Validators.required]],
      status: ['paid', [Validators.required]],
      invoice_number: ['']
    });

    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });

    this.registerForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(3)]],
      sellerName: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });

    // Automatically re-fetch orders on filter change
    this.filterForm.valueChanges.subscribe(() => {
      this.loadOrders();
    });
  }

  loadAllData() {
    this.loadTenant();
    this.loadConnectors();
    this.loadDashboardSummary();
    this.loadOrders();
    this.loadNotifications();
  }

  loadTenant() {
    this.http.get<Tenant>('/api/auth/me').subscribe({
      next: (data) => this.tenant.set(data),
      error: (err) => console.error('Erro ao buscar Tenant:', err)
    });
  }

  loadConnectors() {
    this.http.get<Connector[]>('/api/connectors').subscribe({
      next: (data) => this.connectors.set(data),
      error: (err) => console.error('Erro ao buscar conectores:', err)
    });
  }

  loadDashboardSummary() {
    this.http.get<DashboardSummary>('/api/summary').subscribe({
      next: (data) => this.summary.set(data),
      error: (err) => console.error('Erro ao buscar sumário do painel:', err)
    });
  }

  loadOrders() {
    const filters = this.filterForm.value;
    const params: Record<string, string> = {};
    if (filters.platform && filters.platform !== 'all') params['platform'] = filters.platform;
    if (filters.status && filters.status !== 'all') params['status'] = filters.status;
    if (filters.search && filters.search.trim() !== '') params['search'] = filters.search;

    this.http.get<Order[]>('/api/orders', { params }).subscribe({
      next: (data) => this.orders.set(data),
      error: (err) => console.error('Erro ao buscar ordens de vendas:', err)
    });
  }

  loadNotifications() {
    this.http.get<AppNotification[]>('/api/notifications').subscribe({
      next: (data) => this.notifications.set(data),
      error: (err) => console.error('Erro ao carregar notificações:', err)
    });
  }

  // Tenant switcher - multirole
  switchRole(role: 'seller' | 'accountant' | 'seller_sec') {
    this.http.post<{ success: boolean; user: Tenant }>('/api/auth/switch-role', { role }).subscribe({
      next: (res) => {
        if (res.success) {
          this.tenant.set(res.user);
          this.loadDashboardSummary();
          this.loadOrders();
          
          // Toast-style notification message
          this.addLocalToastNotification(
            'Perfil Alterado', 
            `Acesso reconfigurado para a função de: ${this.getRoleLabel(role)}. Permissões de tela atualizadas.`, 
            'info'
          );
        }
      }
    });
  }

  // Toggle Module Connector
  toggleConnector(key: string, currentStatus: boolean) {
    const nextStatus = !currentStatus;
    this.http.post<{ success: boolean }>('/api/connectors/toggle', { key, active: nextStatus }).subscribe({
      next: (res) => {
        if (res.success) {
          // Update connectors
          this.loadConnectors();
          this.loadTenant();
          // Reload metrics
          this.loadDashboardSummary();
          this.loadOrders();

          this.addLocalToastNotification(
            `Conector ${key.toUpperCase()} atualizado`,
            `O módulo foi ${nextStatus ? 'integrado com sucesso' : 'desativado'}. O painel foi recalculado.`,
            nextStatus ? 'success' : 'warning'
          );
        }
      }
    });
  }

  // Upgrade Plan
  confirmUpgrade(plan: string) {
    this.http.post<{ success: boolean; user: Tenant }>('/api/billing/upgrade', { plan }).subscribe({
      next: (res) => {
        if (res.success) {
          this.tenant.set(res.user);
          this.isUpgradeModalOpen.set(false);
          this.addLocalToastNotification(
            'Assinatura Atualizada',
            `Parabéns! Sua conta agora possui o plano BraSeller ${plan}. Recursos e limites estendidos.`,
            'success'
          );
        }
      }
    });
  }

  // Notifications action
  markAsRead(id: string) {
    this.http.post<{ success: boolean; notifications: AppNotification[] }>('/api/notifications/read', { id }).subscribe({
      next: (res) => {
        if (res.success) {
          this.notifications.set(res.notifications);
        }
      }
    });
  }

  clearNotifications() {
    this.http.post<{ success: boolean }>('/api/notifications/clear', {}).subscribe({
      next: (res) => {
        if (res.success) {
          this.notifications.set([]);
        }
      }
    });
  }

  // Local ephemeral success toaster builder
  private addLocalToastNotification(title: string, message: string, type: 'success' | 'info' | 'warning' | 'danger') {
    const newItem: AppNotification = {
      id: 'n_local_' + Date.now(),
      title,
      message,
      type,
      date: new Date().toISOString(),
      read: false
    };
    this.notifications.update(list => [newItem, ...list]);
  }

  // Order popup management
  openOrderDetails(order: Order) {
    this.selectedOrder.set(order);
    this.isOrderModalOpen.set(true);
  }

  closeOrderDetails() {
    this.isOrderModalOpen.set(false);
    this.selectedOrder.set(null);
  }

  // Sync with connectors
  syncAll() {
    if (this.isSyncing()) return;
    this.isSyncing.set(true);

    this.http.post<{ success: boolean; addedCount: number; message?: string }>('/api/connectors/sync', {}).subscribe({
      next: (res) => {
        this.isSyncing.set(false);
        if (res.success) {
          this.loadAllData();
          this.addLocalToastNotification(
            'Sincronia Concluída',
            `Sincronização modular executada! +${res.addedCount} novos lançamentos fiscais foram importados com sucesso dos canais ativos.`,
            'success'
          );
        } else {
          this.addLocalToastNotification(
            'Falha de Sincronia',
            res.message || 'Houve um erro ao sincronizar.',
            'warning'
          );
        }
      },
      error: (err) => {
        this.isSyncing.set(false);
        console.error('Core sync error:', err);
        this.addLocalToastNotification(
          'Falha de Sincronia',
          'Instabilidade operacional conectiva. Conectores responderam com timeout.',
          'danger'
        );
      }
    });
  }

  // Manual Order insertion
  openManualOrderModal() {
    this.manualForm.reset({
      buyer_name: '',
      item_name: '',
      qty: 1,
      unit_price: 0,
      platform_fee: 0,
      payment_method: 'PIX',
      status: 'paid',
      invoice_number: ''
    });
    this.isManualModalOpen.set(true);
  }

  submitManualOrder() {
    if (this.manualForm.invalid) return;

    this.http.post<{ success: boolean }>('/api/orders', this.manualForm.value).subscribe({
      next: (res) => {
        if (res.success) {
          this.isManualModalOpen.set(false);
          this.loadAllData();
          this.addLocalToastNotification(
            'Lançamento Criado',
            'O lançamento manual foi registrado no banco centralizado BraSeller com sucesso.',
            'success'
          );
        }
      },
      error: (err) => {
        console.error('Falha de escrita:', err);
        this.addLocalToastNotification(
          'Falha de Escrita',
          'Não foi possível registrar o lançamento de canal manual.',
          'danger'
        );
      }
    });
  }

  // Authentication class methods
  submitLogin() {
    if (this.loginForm.invalid) return;
    this.authLoading.set(true);
    this.authError.set('');

    this.http.post<{ success: boolean; user: Tenant }>('/api/auth/login', this.loginForm.value).subscribe({
      next: (res) => {
        this.authLoading.set(false);
        if (res.success) {
          this.tenant.set(res.user);
          this.loadAllData();
          this.addLocalToastNotification(
            'Sessão Iniciada',
            `Bem-vindo de volta, ${res.user.sellerName}!`,
            'success'
          );
        }
      },
      error: (err) => {
        this.authLoading.set(false);
        const errText = err.error?.error || 'Erro operacional no login. Credenciais incorretas.';
        this.authError.set(errText);
        this.addLocalToastNotification('Falha de Login', errText, 'danger');
      }
    });
  }

  submitRegister() {
    if (this.registerForm.invalid) return;
    this.authLoading.set(true);
    this.authError.set('');

    this.http.post<{ success: boolean; user: Tenant }>('/api/auth/register', this.registerForm.value).subscribe({
      next: (res) => {
        this.authLoading.set(false);
        if (res.success) {
          this.tenant.set(res.user);
          this.loadAllData();
          this.addLocalToastNotification(
            'Cadastro Concluído',
            `Conta criada com sucesso para ${res.user.sellerName}!`,
            'success'
          );
        }
      },
      error: (err) => {
        this.authLoading.set(false);
        const errText = err.error?.error || 'Erro ao registrar nova empresa no BraSeller.';
        this.authError.set(errText);
        this.addLocalToastNotification('Falha de Cadastro', errText, 'danger');
      }
    });
  }

  logout() {
    this.http.post<{ success: boolean }>('/api/auth/logout', {}).subscribe({
      next: (res) => {
        if (res.success) {
          this.tenant.set(null);
          this.addLocalToastNotification(
            'Sessão Encerrada',
            'Sua conta foi desconectada com segurança do BraSeller Core.',
            'info'
          );
        }
      },
      error: (err) => {
        this.tenant.set(null); // Bypass error and clear in client anyway
        console.error('Logout failed:', err);
      }
    });
  }

  demoLogin() {
    this.loginForm.patchValue({
      email: 'thousandtws@gmail.com',
      password: 'password123'
    });
    this.submitLogin();
  }

  // Clear query filters
  clearFilters() {
    this.filterForm.patchValue({
      platform: 'all',
      status: 'all',
      search: ''
    });
  }

  // Downloads / accountant triggers
  exportCSV() {
    window.location.href = '/api/export/csv';
  }

  exportExcel() {
    window.location.href = '/api/export/excel';
  }

  exportPDFContador() {
    window.open('/api/export/pdf', '_blank');
  }

  // Send message to Gemini chat server
  sendChatMessage(customText?: string) {
    const textToSend = customText || this.chatForm.get('message')?.value;
    if (!textToSend || textToSend.trim() === '') return;

    // Append user message
    this.chatMessages.update(msgs => [...msgs, {
      role: 'user',
      text: textToSend,
      date: new Date()
    }]);

    if (!customText) {
      this.chatForm.reset();
    }

    this.chatLoading.set(true);

    this.http.post<{ response: string; isReal: boolean }>('/api/gemini/chat', { message: textToSend }).subscribe({
      next: (res) => {
        this.chatMessages.update(msgs => [...msgs, {
          role: 'assistant',
          text: res.response,
          date: new Date(),
          isReal: res.isReal
        }]);
        this.chatLoading.set(false);
        this.scrollToLatestChat();
      },
      error: (err) => {
        console.error('Gemini chat error:', err);
        this.chatMessages.update(msgs => [...msgs, {
          role: 'assistant',
          text: 'Desculpe, ocorreu um erro de conexão com o servidor de Inteligência Analítica.',
          date: new Date()
        }]);
        this.chatLoading.set(false);
      }
    });
  }

  selectSuggestion(sugar: string) {
    this.sendChatMessage(sugar);
  }

  private scrollToLatestChat() {
    setTimeout(() => {
      const container = document.getElementById('chat-history-scroll-box');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }, 100);
  }

  // Helper Labels & Mappings
  getRoleLabel(role: 'seller' | 'accountant' | 'seller_sec'): string {
    const labels = {
      seller: 'Vendedor (Principal)',
      accountant: 'Contador (Somente Leitura)',
      seller_sec: 'Vendedor Secundário'
    };
    return labels[role] || role;
  }

  getPlatformName(key: string): string {
    const names = {
      ml: 'Mercado Livre',
      shopee: 'Shopee',
      amazon: 'Amazon'
    };
    return names[key as 'ml' | 'shopee' | 'amazon'] || key.toUpperCase();
  }

  getUnreadNotificationsCount(): number {
    return this.notifications().filter(n => !n.read).length;
  }

  // Simple Markdown Renderer for high fidelity analytics text formatting (tables, bullet points, headers)
  renderMarkdown(text: string): string {
    if (!text) return '';
    let html = text;

    // Escape basic entities
    html = html
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Headers
    html = html.replace(/^### (.*$)/gim, '<h4 class="text-sm font-semibold text-gray-900 tracking-tight mb-2 mt-4">$1</h4>');
    html = html.replace(/^## (.*$)/gim, '<h3 class="text-base font-semibold text-gray-900 tracking-tight mb-2 mt-4">$1</h3>');
    html = html.replace(/^# (.*$)/gim, '<h2 class="text-lg font-bold text-gray-950 tracking-tight mb-3 mt-4">$1</h2>');

    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<b class="font-semibold text-gray-900">$1</b>');

    // Bullet Lists
    html = html.replace(/^\*\s(.*$)/gim, '<li class="ml-4 list-disc text-xs text-gray-600 mb-1">$1</li>');

    // Code lines / spans
    html = html.replace(/`(.*?)`/g, '<code class="px-1.5 py-0.5 bg-gray-100 font-mono text-xs text-brand rounded">$1</code>');

    // Table parsing helper (Extract markdown tables to tailored Coinbase tables)
    const lines = text.split('\n');
    let inTable = false;
    let tableHtml = '<div class="overflow-x-auto my-3 border border-gray-100 rounded-lg"><table class="w-full text-left text-xs font-sans tracking-tight border-collapse"><thead>';
    
    const renderedRowsLines: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('|') && line.endsWith('|')) {
        const cells = line.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
        
        if (!inTable) {
          inTable = true;
          // Check if this is the header row
          tableHtml += '<tr class="bg-gray-50 border-b border-gray-100">';
          cells.forEach(headerCell => {
            const cleanText = headerCell.replace(/\*\*/g, '');
            tableHtml += `<th class="px-3 py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">${cleanText}</th>`;
          });
          tableHtml += '</tr></thead><tbody>';
          
          // Skip divider row (usually starts with | :--- |)
          if (lines[i+1] && lines[i+1].includes('---')) {
            i++; 
          }
        } else {
          // Regular data row
          tableHtml += '<tr class="border-b border-gray-100 hover:bg-gray-50/50">';
          cells.forEach((cellVal) => {
            // Apply bold formatting within cell if any
            let val = cellVal;
            val = val.replace(/\*\*(.*?)\*\*/g, '<strong class="font-medium text-gray-900">$1</strong>');
            tableHtml += `<td class="px-3 py-2 text-gray-600 whitespace-nowrap">${val}</td>`;
          });
          tableHtml += '</tr>';
        }
      } else {
        if (inTable) {
          inTable = false;
          tableHtml += '</tbody></table></div>';
          renderedRowsLines.push(tableHtml);
          tableHtml = '<div class="overflow-x-auto my-3 border border-gray-100 rounded-lg"><table class="w-full text-left text-xs font-sans tracking-tight border-collapse"><thead>';
        }
        renderedRowsLines.push(line);
      }
    }
    
    if (inTable) {
      tableHtml += '</tbody></table></div>';
      renderedRowsLines.push(tableHtml);
    }
    
    html = renderedRowsLines.join('\n');
    
    // Convert remaining single line-breaks to <br> or paragraphs
    html = html.split('\n').map(p => {
      if (p.trim() === '') return '';
      if (p.startsWith('<li') || p.startsWith('<h') || p.startsWith('<div') || p.startsWith('<table') || p.startsWith('<tr') || p.startsWith('<td')) return p;
      return `<p class="mb-2 text-xs leading-relaxed text-gray-700">${p}</p>`;
    }).join('');

    return html;
  }
}
