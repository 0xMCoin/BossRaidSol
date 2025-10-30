# Boss Raid Security Guide

## 🔒 Proteções Implementadas

### 1. Middleware de Segurança Global
- **Proteção Automática**: Todas as rotas `/api/*` são protegidas
- **API Key Required**: Header `x-api-key` obrigatório para POST requests
- **Origin Validation**: Apenas origens autorizadas podem fazer requests
- **Bot Protection**: Validação básica de User-Agent

### 2. Validação de API Key
- **Environment Variable**: `BOSS_RAID_API_KEY` deve ser configurada
- **Frontend**: `NEXT_PUBLIC_BOSS_RAID_API_KEY` para chamadas do cliente
- **Middleware**: Validação automática em todas as rotas protegidas

### 3. Validação de Origem (CORS-like)
- **Allowed Origins**: Lista de domínios autorizados via `ALLOWED_ORIGINS`
- **Default**: Apenas `http://localhost:3000` em desenvolvimento

### 4. Validação de Dados
- **Trade Data**: Verificação de `signature`, `mint`, `solAmount`, `txType`
- **Rate Limiting**: Máximo 10 trades por segundo
- **Boss State**: Validação de estado do boss antes de modificações

### 5. Validação de Lógica de Saúde
- **Damage Only**: Apenas redução de vida (damage) permitida via API
- **Signature Required**: Toda atualização requer assinatura do trade
- **Health Bounds**: Vida deve estar entre 0 e maxHealth

### 6. Auditoria e Logs
- **Audit Trail**: Todas as modificações são logadas com timestamp
- **Change Tracking**: Registra saúde antiga vs nova
- **Error Logging**: Falhas são registradas sem expor dados sensíveis

## 🛡️ Arquitetura de Segurança

### Middleware Global
```typescript
// src/middleware.ts - Protege automaticamente todas as rotas /api/*
export function middleware(request: NextRequest) {
  // Validação de API Key, Origin, User-Agent
  // Aplica a todas as rotas POST automaticamente
}
```

### Validações em Camadas
1. **Middleware**: Proteção global de API
2. **Route Level**: Validações específicas por endpoint
3. **Database Level**: Validações de lógica de negócio
4. **Client Level**: Rate limiting e validações básicas

## 🚀 Configuração para Produção

### 1. Variáveis de Ambiente
```bash
# Arquivo .env.local
BOSS_RAID_API_KEY=your-super-secure-random-key-here
NEXT_PUBLIC_BOSS_RAID_API_KEY=your-super-secure-random-key-here
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

### 2. Geração de API Key Segura
```bash
# Gere uma chave segura (Linux/Mac)
openssl rand -base64 32

# Ou use Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 3. Configuração do Servidor
- **HTTPS Only**: Force HTTPS em produção
- **Rate Limiting**: Configure no nível do servidor (nginx, cloudflare)
- **Monitoring**: Configure alertas para tentativas de acesso não autorizado
- **Backups**: Backup automático dos dados do jogo

## ⚠️ Riscos Mitigados

### ✅ Protegido Contra:
- **API Abuse**: Sem API key = acesso negado
- **Cross-Origin**: Apenas origens autorizadas
- **Invalid Data**: Trades malformados são rejeitados
- **Rate Attacks**: Flooding limitado a 10 trades/segundo
- **Logic Abuse**: Só damage é permitido via API
- **State Manipulation**: Boss state é validado antes das mudanças

### ⚠️ Ainda Precisa de Atenção:
- **WebSocket Security**: Considere autenticação no WebSocket
- **Database Security**: Use conexão criptografada em produção
- **Backup Strategy**: Implemente backups automáticos
- **Monitoring**: Configure alertas de segurança

## 🔍 Monitoramento

### Logs de Auditoria
Todos os logs de auditoria seguem este formato:
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "bossId": 1,
  "bossName": "Ancient Dragon",
  "oldHealth": 95.5,
  "newHealth": 93.2,
  "isDefeated": false,
  "change": -2.3
}
```

### Alertas de Segurança
Configure alertas para:
- Múltiplas falhas de autenticação
- Tentativas de rate limiting
- Modificações de saúde suspeitas
- Tentativas de acesso não autorizado

## 🧪 Testes de Segurança

### 1. Teste de API Key
```bash
# Deve falhar (401 Unauthorized)
curl -X POST http://localhost:3000/api/bosses \
  -H "Content-Type: application/json" \
  -d '{"action":"updateHealth","bossId":1,"currentHealth":50}'

# Deve funcionar
curl -X POST http://localhost:3000/api/bosses \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key-here" \
  -d '{"action":"updateHealth","bossId":1,"currentHealth":50,"signature":"test-sig"}'
```

### 2. Teste de Rate Limiting
```bash
# Execute múltiplas vezes rapidamente - deve ser limitado após 10 requests
for i in {1..15}; do
  curl -X POST http://localhost:3000/api/bosses \
    -H "Content-Type: application/json" \
    -H "x-api-key: your-api-key-here" \
    -d '{"action":"updateHealth","bossId":1,"currentHealth":50,"signature":"test-sig"}' &
done
```

### 3. Teste de Validação de Dados
```bash
# Deve falhar - saúde inválida
curl -X POST http://localhost:3000/api/bosses \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key-here" \
  -d '{"action":"updateHealth","bossId":1,"currentHealth":-10,"signature":"test-sig"}'
```
