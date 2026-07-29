'use strict';

const settings = {
  storeName: process.env.STORE_NAME || 'MR Pizzaria',
  storePhone: process.env.STORE_PHONE || '4434252285',
  storeAddress: process.env.STORE_ADDRESS || 'Av. Paraná, 897, Centro, Loanda - PR',
  deliveryFee: 7,
  estimatedMinutesMin: 40,
  estimatedMinutesMax: 60,
  openHours: 'Segunda a sábado, das 18h às 22h30',
  pix: '02.597.025/0001-40',
  pizzaPrices: {
    regular: { P: 60, M: 70, G: 80 },
    house: { P: 80, M: 90, G: 100 }
  },
  borders: [
    { key: 'none', name: 'Sem borda', prices: { P: 0, M: 0, G: 0 } },
    { key: 'catupiry', name: 'Borda de Catupiry', prices: { P: 3, M: 4, G: 5 } },
    { key: 'cheddar', name: 'Borda de Cheddar', prices: { P: 3, M: 4, G: 5 } },
    { key: 'chocolate', name: 'Borda de Chocolate', prices: { P: 5, M: 6, G: 7 } }
  ]
};

const flavors = [
  ['Atum','Salgada'],['Baiana','Salgada'],['Brócolis com bacon','Salgada'],['Calabresa','Salgada'],
  ['Calabresa acebolada','Salgada'],['Carne seca','Salgada'],['Coração de frango','Salgada'],['Da Casa','Salgada',true],
  ['Frango','Salgada'],['Frango catupiry','Salgada'],['Frango com bacon','Salgada'],['Frango com cheddar','Salgada'],
  ['Frango com milho','Salgada'],['Frango com palmito','Salgada'],['Frango cremoso','Salgada'],['Frango Mexicano','Salgada'],
  ['Lombo','Salgada'],['Lombo catupiry','Salgada'],['Lombo com palmito','Salgada'],['Margherita','Salgada'],
  ['Milho','Salgada'],['Milho com bacon','Salgada'],['Mussarela','Salgada'],['Napolitana','Salgada'],
  ['Palmito','Salgada'],['Pepperoni','Salgada'],['Portuguesa','Salgada'],['Presunto','Salgada'],
  ['Três queijos','Salgada'],['Quatro queijos','Salgada'],['Rúcula com tomate seco','Salgada'],['Tropical','Salgada'],
  ['Chocolate branco','Doce'],['Chocolate com morango','Doce'],['Dois amores','Doce'],['Ouro Branco','Doce'],
  ['Paçoca','Doce'],['Prestígio','Doce'],['Beijinho','Doce'],['Sonho de Valsa','Doce']
].map(([name, category, premium = false]) => ({ name, category, premium, active: true }));

const products = [
  ['Lanches','X-Burger',18],['Lanches','X-Bacon salada',28],['Lanches','X-Frango',25],['Lanches','X-Egg',23],
  ['Lanches','X-Salada',20],['Lanches','Beirute frango',50],['Lanches','Beirute filé mignon',60],
  ['Porções','Porção de Tilápia',45],['Porções','Batata frita',30],['Porções','Calabresa acebolada',35],
  ['Porções','Frango a passarinho',35],['Porções','Costelinha de pacu',45],['Porções','Fígado acebolado',30],
  ['Porções','Coração de frango',50],['Bebidas','Coca-Cola lata',5],['Bebidas','Coca-Cola Zero lata',5],
  ['Bebidas','Fanta Laranja lata',5],['Bebidas','Fanta Uva lata',5],['Bebidas','Sprite lata',5],['Bebidas','Água',4],
  ['Bebidas','Água com gás',4],['Bebidas','Suco de polpa 360 ml',10],['Bebidas','Amstel 600 ml',10],
  ['Bebidas','Heineken 600 ml',15],['Bebidas','Amstel lata',7],['Bebidas','Heineken long neck',10],
  ['Drinks','Drink com vodka',25],['Drinks','Drink com Velho Barreiro',20],
  ['Doces','Sweetburguer Brigadeiro',28],['Doces','Sweetburguer Oreo',28],['Doces','Petit gâteau',18]
].map(([category, name, price], index) => ({ id: `prod-${index + 1}`, category, name, price, active: true }));

function createInitialData() {
  return {
    meta: { version: 1, nextOrderNumber: 101, createdAt: new Date().toISOString() },
    settings,
    catalog: { flavors, products },
    orders: [],
    customers: []
  };
}

module.exports = { createInitialData };
