export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_POLICY_MESSAGE = "비밀번호는 12자 이상이며 영문 대문자·소문자·숫자를 각각 포함해야 합니다.";

export function isStrongPassword(password: string) {
  return password.length >= PASSWORD_MIN_LENGTH
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /\d/.test(password);
}
