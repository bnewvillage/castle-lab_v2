// Currencies a project item can be costed in. The local three carry no customs
// duty, which is why they are called out separately.
export const LOCAL_CURRENCIES   = ['AED', 'SAR', 'QAR'];
export const PROJECT_CURRENCIES = [...LOCAL_CURRENCIES, 'EUR', 'USD', 'GBP', 'AUD', 'JPY'];
