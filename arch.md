# Arquitetura RAG Serverless na AWS (Atualizada)

- AWS S3:
  - Armazenamento de documentos
  - o bucket deve ser configurado para disparar eventos para o Lambda de indexação e se possivel usar 
    o Amazon S3 Intelligent-Tiering para reduzir custos e também o knolwedge base para indexar os documentos

- AWS Lambda (TypeScript):
  - Função de indexação:
    - Lê documentos do S3 (todos de um mesmo bkt)
    - Processa e indexa o conteúdo
    - Armazena embeddings no OpenSearch
  - Função de chat:
    - Recebe mensagens do API Gateway
    - Busca documentos relevantes no OpenSearch
    - Gera respostas usando Amazon Bedrock (Claude 3 Haiku)

- Amazon OpenSearch Service:
  - Armazena e pesquisa embeddings dos documentos

- Amazon API Gateway:
  - Expõe endpoints WebSocket para comunicação em tempo real

- Amazon Bedrock:
  - Serviço de IA para geração de texto (Claude 3 Haiku)
  - Se possivel usar o Knowledge Base

- AWS IAM:
  - Gerencia permissões e acessos

- Vercel AI SDK (Frontend):
  - Implementa interface de chat e streaming de respostas

- Infraestrutura como código:
  - AWS SAM para gerenciar recursos

Vc deve criar todos os arquivos seguindo a estrutura abaixo
Estrutura de pastas:
```
rag-chat-project/
├── backend/
│   ├── src/
│   │   ├── indexing/
│   │   │   └── index.ts
│   │   └── chat/
│   │       └── index.ts
│   ├── infra.yaml
│   └── samconfig.toml
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── components/
│   │   │   └── ChatComponent.tsx
│   │   ├── App.tsx
│   │   └── index.tsx
│   ├── package.json
│   └── tsconfig.json
├── README.md
└── package.json
```

por favor, siga a estrutura acima 
