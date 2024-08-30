/* eslint-disable turbo/no-undeclared-env-vars */
import { SimpleVectorStore, VectorStoreIndex } from "llamaindex";

export async function getDataSource(params?: any) {
 const simpleVectorStore = new SimpleVectorStore()
  return await VectorStoreIndex.fromVectorStore(simpleVectorStore);
}
