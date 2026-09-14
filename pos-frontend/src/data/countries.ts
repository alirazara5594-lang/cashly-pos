export interface CountryPreset {
  code: string;
  name: string;
  flag: string;
  currencyCode: string;
  currencySymbol: string;
  decimals: number;
  taxAuthority: string;
  defaultTaxRate: number;
  useDualTaxRate: boolean;
  digitalTaxRate: number;
  phoneCode: string;
  defaultCity: string;
  dateFormat: string;
  paymentMethods: string;
}

export const COUNTRIES: CountryPreset[] = [
  {
    code: 'PK', name: 'Pakistan', flag: '🇵🇰',
    currencyCode: 'PKR', currencySymbol: '₨', decimals: 0,
    taxAuthority: 'FBR', defaultTaxRate: 16, useDualTaxRate: true, digitalTaxRate: 8,
    phoneCode: '+92', defaultCity: 'Islamabad', dateFormat: 'dd/MM/yyyy',
    paymentMethods: 'Cash,Card,JazzCash,EasyPaisa,Raast,CustomerKhata',
  },
  {
    code: 'GB', name: 'United Kingdom', flag: '🇬🇧',
    currencyCode: 'GBP', currencySymbol: '£', decimals: 2,
    taxAuthority: 'HMRC', defaultTaxRate: 20, useDualTaxRate: false, digitalTaxRate: 20,
    phoneCode: '+44', defaultCity: 'London', dateFormat: 'dd/MM/yyyy',
    paymentMethods: 'Cash,Card,Stripe',
  },
  {
    code: 'US', name: 'United States', flag: '🇺🇸',
    currencyCode: 'USD', currencySymbol: '$', decimals: 2,
    taxAuthority: 'IRS', defaultTaxRate: 0, useDualTaxRate: false, digitalTaxRate: 0,
    phoneCode: '+1', defaultCity: 'New York', dateFormat: 'MM/dd/yyyy',
    paymentMethods: 'Cash,Card,Stripe,Square',
  },
  {
    code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪',
    currencyCode: 'AED', currencySymbol: 'د.إ', decimals: 2,
    taxAuthority: 'FTA', defaultTaxRate: 5, useDualTaxRate: false, digitalTaxRate: 5,
    phoneCode: '+971', defaultCity: 'Dubai', dateFormat: 'dd/MM/yyyy',
    paymentMethods: 'Cash,Card,ApplePay',
  },
  {
    code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦',
    currencyCode: 'SAR', currencySymbol: '﷼', decimals: 2,
    taxAuthority: 'ZATCA', defaultTaxRate: 15, useDualTaxRate: false, digitalTaxRate: 15,
    phoneCode: '+966', defaultCity: 'Riyadh', dateFormat: 'dd/MM/yyyy',
    paymentMethods: 'Cash,Card,Mada',
  },
  {
    code: 'TR', name: 'Turkey', flag: '🇹🇷',
    currencyCode: 'TRY', currencySymbol: '₺', decimals: 2,
    taxAuthority: 'GIB', defaultTaxRate: 20, useDualTaxRate: false, digitalTaxRate: 20,
    phoneCode: '+90', defaultCity: 'Istanbul', dateFormat: 'dd/MM/yyyy',
    paymentMethods: 'Cash,Card,Papara',
  },
  {
    code: 'CN', name: 'China', flag: '🇨🇳',
    currencyCode: 'CNY', currencySymbol: '¥', decimals: 2,
    taxAuthority: 'SAT', defaultTaxRate: 6, useDualTaxRate: false, digitalTaxRate: 6,
    phoneCode: '+86', defaultCity: 'Shanghai', dateFormat: 'yyyy/MM/dd',
    paymentMethods: 'Cash,Card,WeChat,AliPay',
  },
  {
    code: 'JP', name: 'Japan', flag: '🇯🇵',
    currencyCode: 'JPY', currencySymbol: '¥', decimals: 0,
    taxAuthority: 'NTA', defaultTaxRate: 10, useDualTaxRate: false, digitalTaxRate: 10,
    phoneCode: '+81', defaultCity: 'Tokyo', dateFormat: 'yyyy/MM/dd',
    paymentMethods: 'Cash,Card,PayPay',
  },
  {
    code: 'FR', name: 'France', flag: '🇫🇷',
    currencyCode: 'EUR', currencySymbol: '€', decimals: 2,
    taxAuthority: 'DGFiP', defaultTaxRate: 20, useDualTaxRate: false, digitalTaxRate: 20,
    phoneCode: '+33', defaultCity: 'Paris', dateFormat: 'dd/MM/yyyy',
    paymentMethods: 'Cash,Card,Stripe',
  },
  {
    code: 'DE', name: 'Germany', flag: '🇩🇪',
    currencyCode: 'EUR', currencySymbol: '€', decimals: 2,
    taxAuthority: 'BZSt', defaultTaxRate: 19, useDualTaxRate: false, digitalTaxRate: 19,
    phoneCode: '+49', defaultCity: 'Berlin', dateFormat: 'dd/MM/yyyy',
    paymentMethods: 'Cash,Card,Stripe',
  },
];

export function getCountryByCode(code: string): CountryPreset | undefined {
  return COUNTRIES.find(c => c.code === code);
}
