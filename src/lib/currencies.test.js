import { currencyCodes, newCurrencyProblem, rateProblem, rateChangePct } from './currencies';

test('the currency list is every rate, A to Z', () => {
  expect(currencyCodes({ USD: 3.67, AED: 1, SGD: 2.83, EUR: 3.95 })).toEqual(['AED', 'EUR', 'SGD', 'USD']);
});

test('a new currency needs a three-letter code not already listed, and a rate above 0', () => {
  const existing = ['AED', 'EUR'];
  expect(newCurrencyProblem('SGD', '2.83', existing)).toBeNull();
  expect(newCurrencyProblem('SG', '2.83', existing)).toMatch(/three letters/);
  expect(newCurrencyProblem('sgd', '2.83', existing)).toMatch(/three letters/);   // the page upper-cases before checking
  expect(newCurrencyProblem('EUR', '3.9', existing)).toMatch(/already/);
  expect(newCurrencyProblem('SGD', '0', existing)).toMatch(/above 0/);
  expect(newCurrencyProblem('SGD', 'abc', existing)).toMatch(/above 0/);
  expect(rateProblem(-1)).toMatch(/above 0/);
  expect(rateProblem('11.904762')).toBeNull();
});

test('a rate change is shown against the old rate', () => {
  expect(rateChangePct(2.8, 2.828)).toBeCloseTo(1, 9);
  expect(rateChangePct(2.83, 0.353)).toBeCloseTo(-87.5, 1);   // entered the wrong way round
  expect(rateChangePct(2.83, '')).toBeNull();
});
