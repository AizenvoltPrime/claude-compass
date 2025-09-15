import { helper, Calculator } from './utils.js';

function main() {
  const calc = new Calculator();
  const result = calc.add(5, 3);
  console.log(helper('Result:', result));
}

export default main;