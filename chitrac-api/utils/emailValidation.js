const VALID_TLDS = new Set([
  'aaa', 'aarp', 'abb', 'abbott', 'abbvie', 'abc', 'able', 'abogado', 'academy', 'accenture', 'accountant',
  'accountants', 'aco', 'actor', 'ads', 'adult', 'aeg', 'aero', 'africa', 'agakhan', 'agency', 'aig', 'airforce',
  'airtel', 'allfinanz', 'alsace', 'amsterdam', 'android', 'apartments', 'app', 'apple', 'aquarelle', 'arab',
  'archi', 'army', 'arpa', 'art', 'arte', 'asda', 'asia', 'associates', 'attorney', 'auction', 'audio', 'auto',
  'autos', 'avianca', 'aws', 'baby', 'band', 'bank', 'bar', 'barcelona', 'barclaycard', 'barclays', 'barefoot',
  'bargains', 'baseball', 'basketball', 'bauhaus', 'bayern', 'bbc', 'bbt', 'bbva', 'bcg', 'bcn', 'beats',
  'beauty', 'beer', 'bentley', 'berlin', 'best', 'bestbuy', 'bet', 'bible', 'bid', 'bike', 'bing', 'bingo',
  'bio', 'black', 'blackfriday', 'blockbuster', 'blog', 'blue', 'bmw', 'bnpparibas', 'boats', 'bond', 'boo',
  'book', 'booking', 'bosch', 'boston', 'bot', 'boutique', 'box', 'bradesco', 'bridgestone', 'broker',
  'brother', 'brussels', 'build', 'builders', 'business', 'buy', 'buzz', 'cab', 'cafe', 'cal', 'camera',
  'camp', 'canon', 'capetown', 'capital', 'capitalone', 'car', 'cards', 'care', 'career', 'careers', 'cars',
  'casa', 'case', 'cash', 'casino', 'cat', 'catering', 'catholic', 'center', 'ceo', 'cern', 'cfa', 'cfd',
  'channel', 'charity', 'chase', 'chat', 'cheap', 'chintai', 'christmas', 'chrome', 'church', 'cipriani',
  'circle', 'cisco', 'citadel', 'citi', 'claims', 'cleaning', 'click', 'clinic', 'clinique', 'clothing',
  'cloud', 'club', 'coach', 'codes', 'coffee', 'college', 'cologne', 'com', 'commbank', 'community', 'company',
  'compare', 'computer', 'comsec', 'condos', 'construction', 'consulting', 'contact', 'contractors', 'cooking',
  'cool', 'coop', 'corsica', 'country', 'coupon', 'coupons', 'courses', 'cpa', 'credit', 'creditcard',
  'creditunion', 'cricket', 'crown', 'crs', 'cruise', 'cruises', 'cuisinella', 'cymru', 'cyou', 'dad', 'dance',
  'data', 'date', 'dating', 'datsun', 'day', 'dclk', 'dds', 'deal', 'dealer', 'deals', 'degree', 'delivery',
  'dell', 'deloitte', 'delta', 'democrat', 'dental', 'dentist', 'desi', 'design', 'dev', 'diamonds', 'diet',
  'digital', 'direct', 'directory', 'discount', 'discover', 'dish', 'diy', 'docs', 'doctor', 'dog', 'domains',
  'dot', 'download', 'drive', 'dtv', 'dubai', 'duck', 'dunlop', 'dupont', 'durban', 'dvag', 'earth', 'eat',
  'eco', 'edeka', 'edu', 'education', 'email', 'emerck', 'energy', 'engineer', 'engineering', 'enterprises',
  'epson', 'equipment', 'estate', 'events', 'exchange', 'expert', 'exposed', 'express', 'extraspace', 'fage',
  'fail', 'fairwinds', 'faith', 'family', 'fan', 'fans', 'farm', 'farmers', 'fashion', 'fast', 'fedex',
  'feedback', 'ferrari', 'ferrero', 'fiat', 'fidelity', 'fido', 'film', 'final', 'finance', 'financial', 'fire',
  'firestone', 'firmdale', 'fish', 'fishing', 'fit', 'fitness', 'flights', 'florist', 'flowers', 'fly', 'foo',
  'food', 'football', 'ford', 'forex', 'forsale', 'forum', 'foundation', 'fox', 'free', 'fresenius', 'frl',
  'frogans', 'frontdoor', 'frontier', 'ftr', 'fujitsu', 'fun', 'fund', 'furniture', 'futbol', 'fyi', 'gal',
  'gallery', 'game', 'games', 'gap', 'garden', 'gay', 'gbiz', 'gdn', 'gea', 'gent', 'genting', 'george',
  'ggee', 'gift', 'gifts', 'gives', 'giving', 'glass', 'gle', 'global', 'globo', 'gmail', 'gmbh', 'gmo',
  'gmx', 'godaddy', 'gold', 'goldpoint', 'golf', 'goo', 'goodyear', 'goog', 'google', 'gop', 'got', 'gov',
  'grainger', 'graphics', 'gratis', 'green', 'gripe', 'grocery', 'group', 'guardian', 'gucci', 'guge', 'guide',
  'guitars', 'guru', 'hair', 'hangout', 'haus', 'hbo', 'hdfc', 'health', 'healthcare', 'help', 'helsinki',
  'here', 'hiphop', 'hisamitsu', 'hitachi', 'hiv', 'hkt', 'hockey', 'holdings', 'holiday', 'homedepot',
  'homegoods', 'homes', 'homesense', 'honda', 'horse', 'hospital', 'host', 'hosting', 'hot', 'hotels', 'hotmail',
  'house', 'how', 'hsbc', 'hughes', 'hyatt', 'hyundai', 'ibm', 'icu', 'ieee', 'ifm', 'ikano', 'imamat', 'imdb',
  'immo', 'immobilien', 'inc', 'industries', 'infiniti', 'info', 'ing', 'ink', 'institute', 'insurance', 'insure',
  'int', 'international', 'intuit', 'investments', 'ipiranga', 'irish', 'ismaili', 'ist', 'istanbul', 'itau',
  'itv', 'jaguar', 'java', 'jcb', 'jeep', 'jetzt', 'jewelry', 'jio', 'jll', 'jmp', 'jnj', 'joburg', 'jot',
  'joy', 'jpmorgan', 'jprs', 'juniper', 'kaufen', 'kddi', 'kerryhotels', 'kerrylogistics', 'kerryproperties',
  'kfh', 'kia', 'kids', 'kim', 'kindle', 'kitchen', 'kiwi', 'koeln', 'komatsu', 'kosher', 'kpmg', 'kpn',
  'krd', 'kred', 'kuokgroup', 'kyoto', 'lacaixa', 'lamborghini', 'lamer', 'lancaster', 'lancia', 'land',
  'landrover', 'lanxess', 'lasalle', 'lat', 'latino', 'latrobe', 'law', 'lawyer', 'lds', 'lease', 'leclerc',
  'lefrak', 'legal', 'lego', 'lexus', 'lgbt', 'lidl', 'life', 'lifeinsurance', 'lifestyle', 'lighting', 'like',
  'lilly', 'limited', 'limo', 'lincoln', 'linde', 'link', 'lipsy', 'live', 'living', 'llc', 'llp', 'loan',
  'loans', 'locker', 'locus', 'lol', 'london', 'lotte', 'lotto', 'love', 'lpl', 'lplfinancial', 'ltd', 'ltda',
  'lundbeck', 'luxe', 'luxury', 'macys', 'madrid', 'maif', 'maison', 'makeup', 'man', 'management', 'mango',
  'map', 'market', 'marketing', 'markets', 'marriott', 'marshalls', 'maserati', 'mattel', 'mba', 'mckinsey',
  'med', 'media', 'meet', 'melbourne', 'meme', 'memorial', 'men', 'menu', 'merckmsd', 'miami', 'microsoft',
  'mil', 'mini', 'mint', 'mit', 'mitsubishi', 'mlb', 'mls', 'mma', 'mobile', 'moda', 'moe', 'moi', 'mom',
  'monash', 'money', 'monster', 'mormon', 'mortgage', 'moscow', 'moto', 'motorcycles', 'mov', 'movie', 'msd',
  'mtn', 'mtr', 'music', 'mutual', 'nab', 'nagoya', 'name', 'navy', 'nba', 'nec', 'net', 'netbank', 'netflix',
  'network', 'neustar', 'new', 'news', 'next', 'nextdirect', 'nexus', 'nfl', 'ngo', 'nhk', 'nico', 'nike',
  'nikon', 'ninja', 'nissan', 'nissay', 'nokia', 'norton', 'now', 'nowruz', 'nowtv', 'nra', 'nrw', 'ntt',
  'nyc', 'obi', 'observer', 'office', 'okinawa', 'olayan', 'olayangroup', 'oldnavy', 'ollo', 'omega', 'one',
  'ong', 'onl', 'online', 'ooo', 'open', 'oracle', 'orange', 'org', 'organic', 'origins', 'osaka', 'otsuka',
  'ott', 'ovh', 'page', 'panasonic', 'paris', 'pars', 'partners', 'parts', 'party', 'pay', 'pccw', 'pet',
  'pfizer', 'pharmacy', 'phd', 'philips', 'phone', 'photo', 'photography', 'photos', 'physio', 'pics',
  'pictet', 'pictures', 'pid', 'pin', 'ping', 'pink', 'pioneer', 'pizza', 'place', 'play', 'playstation',
  'plumbing', 'plus', 'pnc', 'pohl', 'poker', 'politie', 'porn', 'post', 'pramerica', 'press', 'prime', 'pro',
  'prod', 'productions', 'prof', 'progressive', 'promo', 'properties', 'property', 'protection', 'pru',
  'prudential', 'pub', 'pwc', 'qpon', 'quebec', 'quest', 'racing', 'radio', 'read', 'realestate', 'realtor',
  'realty', 'recipes', 'red', 'redstone', 'redumbrella', 'rehab', 'reise', 'reisen', 'reit', 'reliance', 'ren',
  'rent', 'rentals', 'repair', 'report', 'republican', 'rest', 'restaurant', 'review', 'reviews', 'rexroth',
  'rich', 'richardli', 'ricoh', 'ril', 'rio', 'rip', 'rocher', 'rocks', 'rodeo', 'rogers', 'room', 'rsvp',
  'rugby', 'ruhr', 'run', 'rwe', 'ryukyu', 'saarland', 'safe', 'safety', 'sakura', 'sale', 'salon', 'samsclub',
  'samsung', 'sandvik', 'sandvikcoromant', 'sanofi', 'sap', 'sarl', 'sas', 'save', 'saxo', 'sbi', 'sbs',
  'sca', 'scb', 'schaeffler', 'schmidt', 'scholarships', 'school', 'schule', 'schwarz', 'science', 'scot',
  'search', 'seat', 'secure', 'security', 'seek', 'select', 'sener', 'services', 'seven', 'sew', 'sex', 'sexy',
  'sfr', 'shangrila', 'sharp', 'shaw', 'shell', 'shia', 'shiksha', 'shoes', 'shop', 'shopping', 'shouji',
  'show', 'silk', 'sina', 'singles', 'site', 'ski', 'skin', 'sky', 'skype', 'sling', 'smart', 'smile', 'sncf',
  'soccer', 'social', 'softbank', 'software', 'sohu', 'solar', 'solutions', 'song', 'sony', 'soy', 'spa',
  'space', 'sport', 'spot', 'spreadbetting', 'srl', 'stada', 'staples', 'star', 'statebank', 'statefarm',
  'stc', 'stcgroup', 'stockholm', 'storage', 'store', 'stream', 'studio', 'study', 'style', 'sucks',
  'supplies', 'supply', 'support', 'surf', 'surgery', 'suzuki', 'swatch', 'swiftcover', 'swiss', 'sydney',
  'symantec', 'systems', 'tab', 'taipei', 'talk', 'taobao', 'target', 'tatamotors', 'tatar', 'tattoo', 'tax',
  'taxi', 'tci', 'tdk', 'team', 'tech', 'technology', 'tel', 'temasek', 'tennis', 'teva', 'thd', 'theater',
  'theatre', 'tiaa', 'tickets', 'tienda', 'tips', 'tires', 'tirol', 'tjmaxx', 'tjx', 'tkmaxx', 'tmall',
  'today', 'tokyo', 'tools', 'top', 'toray', 'toshiba', 'total', 'tours', 'town', 'toyota', 'toys', 'trade',
  'trading', 'training', 'travel', 'travelers', 'travelersinsurance', 'trust', 'trv', 'tube', 'tui', 'tunes',
  'tushu', 'tvs', 'ubank', 'ubs', 'unicom', 'university', 'uno', 'uol', 'ups', 'vacations', 'vana', 'vanguard',
  'vegas', 'ventures', 'verisign', 'versicherung', 'vet', 'viajes', 'video', 'vig', 'viking', 'villas', 'vin',
  'vip', 'virgin', 'visa', 'vision', 'viva', 'vivo', 'vlaanderen', 'vodka', 'volkswagen', 'volvo', 'vote',
  'voting', 'voto', 'voyage', 'wales', 'walmart', 'walter', 'wang', 'wanggou', 'watch', 'watches', 'weather',
  'weatherchannel', 'webcam', 'weber', 'website', 'wed', 'wedding', 'weibo', 'weir', 'whoswho', 'wien', 'wiki',
  'williamhill', 'win', 'windows', 'wine', 'winners', 'wme', 'wolterskluwer', 'woodside', 'work', 'works',
  'world', 'wow', 'wtc', 'wtf', 'xbox', 'xerox', 'xfinity', 'xihuan', 'xin', 'xn--p1ai', 'xyz', 'yachts',
  'yahoo', 'yamaxun', 'yandex', 'yodobashi', 'yoga', 'yokohama', 'you', 'youtube', 'yun', 'zappos', 'zara',
  'zero', 'zip', 'zone', 'zuerich',
  'ac', 'ad', 'ae', 'af', 'ag', 'ai', 'al', 'am', 'ao', 'aq', 'ar', 'as', 'at', 'au', 'aw', 'ax', 'az',
  'ba', 'bb', 'bd', 'be', 'bf', 'bg', 'bh', 'bi', 'bj', 'bm', 'bn', 'bo', 'br', 'bs', 'bt', 'bw', 'by',
  'bz', 'ca', 'cc', 'cd', 'cf', 'cg', 'ch', 'ci', 'ck', 'cl', 'cm', 'cn', 'co', 'cr', 'cu', 'cv', 'cw',
  'cx', 'cy', 'cz', 'de', 'dj', 'dk', 'dm', 'do', 'dz', 'ec', 'ee', 'eg', 'er', 'es', 'et', 'eu', 'fi',
  'fj', 'fk', 'fm', 'fo', 'fr', 'ga', 'gd', 'ge', 'gf', 'gg', 'gh', 'gi', 'gl', 'gm', 'gn', 'gp', 'gq',
  'gr', 'gs', 'gt', 'gu', 'gw', 'gy', 'hk', 'hm', 'hn', 'hr', 'ht', 'hu', 'id', 'ie', 'il', 'im', 'in',
  'io', 'iq', 'ir', 'is', 'it', 'je', 'jm', 'jo', 'jp', 'ke', 'kg', 'kh', 'ki', 'km', 'kn', 'kp', 'kr',
  'kw', 'ky', 'kz', 'la', 'lb', 'lc', 'li', 'lk', 'lr', 'ls', 'lt', 'lu', 'lv', 'ly', 'ma', 'mc', 'md',
  'me', 'mg', 'mh', 'mk', 'ml', 'mm', 'mn', 'mo', 'mp', 'mq', 'mr', 'ms', 'mt', 'mu', 'mv', 'mw', 'mx',
  'my', 'mz', 'na', 'nc', 'ne', 'nf', 'ng', 'ni', 'nl', 'no', 'np', 'nr', 'nu', 'nz', 'om', 'pa', 'pe',
  'pf', 'pg', 'ph', 'pk', 'pl', 'pm', 'pn', 'pr', 'ps', 'pt', 'pw', 'py', 'qa', 're', 'ro', 'rs', 'ru',
  'rw', 'sa', 'sb', 'sc', 'sd', 'se', 'sg', 'sh', 'si', 'sk', 'sl', 'sm', 'sn', 'so', 'sr', 'ss', 'st',
  'su', 'sv', 'sx', 'sy', 'sz', 'tc', 'td', 'tf', 'tg', 'th', 'tj', 'tk', 'tl', 'tm', 'tn', 'to', 'tr',
  'tt', 'tv', 'tw', 'tz', 'ua', 'ug', 'uk', 'us', 'uy', 'uz', 'va', 'vc', 've', 'vg', 'vi', 'vn', 'vu',
  'wf', 'ws', 'ye', 'yt', 'za', 'zm', 'zw'
]);

function getEmailValidationError(email, options = {}) {
  const { required = false } = options;
  const value = `${email || ''}`.trim();

  if (!value) {
    return required ? 'Email address is required' : null;
  }

  if (value.length > 254) {
    return 'Email address must be 254 characters or fewer';
  }

  const parts = value.split('@');
  if (parts.length !== 2) {
    return 'Email address must be in the format name@domain.tld';
  }

  const [localPart, domain] = parts;
  if (!localPart || localPart.length > 64 || !domain || domain.length > 253) {
    return 'Email address must be in the format name@domain.tld';
  }

  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(localPart)) {
    return 'Email address contains invalid characters';
  }

  if (localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..')) {
    return 'Email address contains invalid punctuation';
  }

  const labels = domain.toLowerCase().split('.');
  if (labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    return 'Email domain must be in the format domain.tld';
  }

  const tld = labels[labels.length - 1];
  if (!VALID_TLDS.has(tld)) {
    return 'Email address must use a valid top-level domain';
  }

  return null;
}

function isValidEmailAddress(email, options = {}) {
  return getEmailValidationError(email, options) === null;
}

module.exports = {
  VALID_TLDS,
  getEmailValidationError,
  isValidEmailAddress
};
