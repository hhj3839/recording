// Retired: use approved-pool comment jobs; never redirect POST or start AI here.
export async function POST() {
  return Response.json({
    code: "LEGACY_GENERATION_RETIRED",
    error: "이전 생성 방식은 종료되었습니다. 페이지를 새로고침한 뒤 교과평어 화면에서 진행해 주세요.",
  }, { status: 410 });
}
