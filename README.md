# MercadoMap 🛒

Comparador de preços de supermercados com scan de notas fiscais via IA.

---

## Deploy no Vercel (passo a passo)

### 1. Instalar o Git
Baixe em https://git-scm.com/download/win e instale com as opções padrão.

### 2. Criar conta no GitHub
Acesse https://github.com e crie uma conta gratuita.

### 3. Criar repositório no GitHub
1. Clique em **New repository**
2. Nome: `mercadomap`
3. Deixe **Private** (só você vê)
4. Clique em **Create repository**

### 4. Enviar o projeto para o GitHub
Abra o PowerShell na pasta do projeto e rode:

```powershell
git init
git add .
git commit -m "feat: versão inicial do MercadoMap"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/mercadomap.git
git push -u origin main
```

### 5. Deploy no Vercel
1. Acesse https://vercel.com e crie conta com o GitHub
2. Clique em **Add New Project**
3. Selecione o repositório `mercadomap`
4. Clique em **Deploy** — pronto!

Sua URL será algo como: `https://mercadomap-xxx.vercel.app`

---

## Atualizar o app depois

Toda vez que baixar uma versão nova do `.jsx` aqui do Claude:

```powershell
# Substitua o arquivo App.jsx pelo novo que baixou
copy C:\Users\SEU-USUARIO\Downloads\mercadomap.jsx src\App.jsx

# Envie para o GitHub (Vercel atualiza automaticamente)
git add .
git commit -m "feat: descreva o que mudou aqui"
git push
```

O Vercel detecta o push e republica em ~1 minuto.

---

## Rodar localmente (opcional)

```powershell
# Instalar Node.js primeiro: https://nodejs.org (versão LTS)
npm install
npm start
# Abre em http://localhost:3000
```

---

## Estrutura do projeto

```
mercadomap/
├── public/
│   └── index.html
├── src/
│   ├── App.jsx      ← todo o código do app fica aqui
│   └── index.js
├── .gitignore
├── package.json
└── README.md
```
