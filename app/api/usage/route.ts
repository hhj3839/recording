import { getAiUsage } from "../../ai-usage";
import { dataError, getDataScope } from "../../data-scope";

export async function GET() {
  try {
    const { user } = await getDataScope();
    return Response.json(await getAiUsage(user.id));
  } catch (error) {
    return dataError(error, "AI 사용량을 불러오지 못했습니다.");
  }
}
