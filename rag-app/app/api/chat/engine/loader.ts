import { PDFReader } from "llamaindex";
import { FILE_EXT_TO_READER } from "llamaindex/readers/SimpleDirectoryReader";
import S3Storage from "../infra/storage/s3-storage";

export const DATA_DIR = "./data";

export function getExtractors() {
  return FILE_EXT_TO_READER;
}

export async function getDocuments() {
  try {
    const s3 = new S3Storage();
    const allDocuments = await s3.getAllObjects({
      storageName: "doth-iaus",
      prefix: "erp/15/juridico/",
    });
    const reader = new PDFReader();

    for await (const document of allDocuments) {
      console.log("Processing document", document.Key, document.Size === 0);
      if (document?.Size && document.Size === 0) {
        console.log("Skipping empty document", document.Key);
        continue;
      }
      const file = await s3.getObject("doth-iaus", document.Key as string);
      const chunks = [];
      for await (const chunk of file!.body) {
        chunks.push(chunk);
      }
      await reader.loadDataAsContent(new Uint8Array(chunks));
    }
  } catch (error) {
    console.error(error);
  }
}
