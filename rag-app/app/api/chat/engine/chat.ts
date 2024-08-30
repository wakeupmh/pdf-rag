import { ContextChatEngine, Settings } from "llamaindex";
import { getDataSource } from "./index";

export async function createChatEngine(documentIds?: string[], params?: any) {
  const index = await getDataSource(params);
  if (!index) {
    throw new Error(
      `StorageContext is empty - call 'npm run generate' to generate the storage first`,
    );
  }
  const retriever = index.asRetriever({
    similarityTopK: process.env.TOP_K ? parseInt(process.env.TOP_K) : undefined,
  });

  return new ContextChatEngine({
    chatModel: Settings.llm,
    retriever,
    systemPrompt: process.env.SYSTEM_PROMPT,
  });
}
