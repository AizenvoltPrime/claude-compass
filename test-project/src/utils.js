export function helper(message, value) {
  return `${message} ${value}`;
}

export class Calculator {
  add(a, b) {
    return a + b;
  }

  multiply(a, b) {
    return a * b;
  }
}

const SECRET_KEY = 'dev-key';
export { SECRET_KEY };