export type SignupProfile = {
  displayName: string;
  schoolName: string;
  schoolYear: number;
  semester: number;
  grade: number;
  classNumber: number;
};

export function validateSignupProfile(input: SignupProfile) {
  if (input.displayName.length < 2 || input.displayName.length > 40) return "교사 이름을 2~40자로 입력해 주세요.";
  if (input.schoolName.length < 2 || input.schoolName.length > 100) return "학교명을 2~100자로 입력해 주세요.";
  if (!Number.isInteger(input.schoolYear) || input.schoolYear < 2000 || input.schoolYear > 2100) return "학년도를 확인해 주세요.";
  if (![1, 2].includes(input.semester)) return "학기를 확인해 주세요.";
  if (!Number.isInteger(input.grade) || input.grade < 1 || input.grade > 6) return "학년을 1~6으로 입력해 주세요.";
  if (!Number.isInteger(input.classNumber) || input.classNumber < 1 || input.classNumber > 99) return "반을 1~99로 입력해 주세요.";
  return "";
}
