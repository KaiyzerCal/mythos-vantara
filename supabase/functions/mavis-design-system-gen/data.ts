// AUTO-GENERATED from ui-ux-pro-max-skill CSV data
// Source: https://github.com/KaiyzerCal/ui-ux-pro-max-skill
// 161 reasoning rules · 161 color palettes · 73 font pairings · 161 product types

export interface ReasoningRule {
  category: string; pattern: string; style: string; color_mood: string;
  typography_mood: string; effects: string; anti_patterns: string; severity: string;
}
export interface ColorPalette {
  product: string; primary: string; secondary: string; accent: string;
  background: string; foreground: string; card: string; muted: string;
  border: string; muted_fg: string; notes: string;
}
export interface Typography {
  name: string; category: string; heading: string; body: string;
  mood: string; best_for: string; css_import: string; tailwind: string;
}
export interface ProductType {
  type: string; keywords: string; style: string; pattern: string;
}

export const REASONING_RULES: ReasoningRule[] = [
  {
    "category": "SaaS (General)",
    "pattern": "Hero + Features + CTA",
    "style": "Glassmorphism + Flat Design",
    "color_mood": "Trust blue + Accent contrast",
    "typography_mood": "Professional + Hierarchy",
    "effects": "Subtle hover (200-250ms) + Smooth transitions",
    "anti_patterns": "Excessive animation + Dark mode by default",
    "severity": "HIGH"
  },
  {
    "category": "Micro SaaS",
    "pattern": "Hero-Centric + Trust",
    "style": "Motion-Driven + Vibrant & Block",
    "color_mood": "Bold primaries + Accent contrast",
    "typography_mood": "Modern + Energetic typography",
    "effects": "Scroll-triggered animations + Parallax",
    "anti_patterns": "Static design + No video + Poor mobile",
    "severity": "HIGH"
  },
  {
    "category": "E-commerce",
    "pattern": "Feature-Rich Showcase",
    "style": "Vibrant & Block-based",
    "color_mood": "Brand primary + Success green",
    "typography_mood": "Engaging + Clear hierarchy",
    "effects": "Card hover lift (200ms) + Scale effect",
    "anti_patterns": "Flat design without depth + Text-heavy pages",
    "severity": "HIGH"
  },
  {
    "category": "E-commerce Luxury",
    "pattern": "Feature-Rich Showcase",
    "style": "Liquid Glass + Glassmorphism",
    "color_mood": "Premium colors + Minimal accent",
    "typography_mood": "Elegant + Refined typography",
    "effects": "Chromatic aberration + Fluid animations (400-600ms)",
    "anti_patterns": "Vibrant & Block-based + Playful colors",
    "severity": "HIGH"
  },
  {
    "category": "B2B Service",
    "pattern": "Feature-Rich Showcase + Trust",
    "style": "Trust & Authority + Minimalism",
    "color_mood": "Professional blue + Neutral grey",
    "typography_mood": "Formal + Clear typography",
    "effects": "Section transitions + Feature reveals",
    "anti_patterns": "Playful design + Hidden credentials + AI purple/pink gradients",
    "severity": "HIGH"
  },
  {
    "category": "Financial Dashboard",
    "pattern": "Data-Dense Dashboard",
    "style": "Dark Mode (OLED) + Data-Dense",
    "color_mood": "Dark bg + Red/Green alerts + Trust blue",
    "typography_mood": "Clear + Readable typography",
    "effects": "Real-time number animations + Alert pulse",
    "anti_patterns": "Light mode default + Slow rendering",
    "severity": "HIGH"
  },
  {
    "category": "Analytics Dashboard",
    "pattern": "Data-Dense + Drill-Down",
    "style": "Data-Dense + Heat Map",
    "color_mood": "Cool→Hot gradients + Neutral grey",
    "typography_mood": "Clear + Functional typography",
    "effects": "Hover tooltips + Chart zoom + Filter animations",
    "anti_patterns": "Ornate design + No filtering",
    "severity": "HIGH"
  },
  {
    "category": "Healthcare App",
    "pattern": "Social Proof-Focused",
    "style": "Neumorphism + Accessible & Ethical",
    "color_mood": "Calm blue + Health green",
    "typography_mood": "Readable + Large type (16px+)",
    "effects": "Soft box-shadow + Smooth press (150ms)",
    "anti_patterns": "Bright neon colors + Motion-heavy animations + AI purple/pink gradients",
    "severity": "HIGH"
  },
  {
    "category": "Educational App",
    "pattern": "Feature-Rich Showcase",
    "style": "Claymorphism + Micro-interactions",
    "color_mood": "Playful colors + Clear hierarchy",
    "typography_mood": "Friendly + Engaging typography",
    "effects": "Soft press (200ms) + Fluffy elements",
    "anti_patterns": "Dark modes + Complex jargon",
    "severity": "MEDIUM"
  },
  {
    "category": "Creative Agency",
    "pattern": "Storytelling-Driven",
    "style": "Brutalism + Motion-Driven",
    "color_mood": "Bold primaries + Artistic freedom",
    "typography_mood": "Bold + Expressive typography",
    "effects": "CRT scanlines + Neon glow + Glitch effects",
    "anti_patterns": "Corporate minimalism + Hidden portfolio",
    "severity": "HIGH"
  },
  {
    "category": "Portfolio/Personal",
    "pattern": "Storytelling-Driven",
    "style": "Motion-Driven + Minimalism",
    "color_mood": "Brand primary + Artistic",
    "typography_mood": "Expressive + Variable typography",
    "effects": "Parallax (3-5 layers) + Scroll-triggered reveals",
    "anti_patterns": "Corporate templates + Generic layouts",
    "severity": "MEDIUM"
  },
  {
    "category": "Gaming",
    "pattern": "Feature-Rich Showcase",
    "style": "3D & Hyperrealism + Retro-Futurism",
    "color_mood": "Vibrant + Neon + Immersive",
    "typography_mood": "Bold + Impactful typography",
    "effects": "WebGL 3D rendering + Glitch effects",
    "anti_patterns": "Minimalist design + Static assets",
    "severity": "HIGH"
  },
  {
    "category": "Government/Public Service",
    "pattern": "Minimal & Direct",
    "style": "Accessible & Ethical + Minimalism",
    "color_mood": "Professional blue + High contrast",
    "typography_mood": "Clear + Large typography",
    "effects": "Clear focus rings (3-4px) + Skip links",
    "anti_patterns": "Ornate design + Low contrast + Motion effects + AI purple/pink gradients",
    "severity": "HIGH"
  },
  {
    "category": "Fintech/Crypto",
    "pattern": "Trust & Authority",
    "style": "Minimalism + Accessible & Ethical",
    "color_mood": "Navy + Trust Blue + Gold",
    "typography_mood": "Professional + Trustworthy",
    "effects": "Smooth state transitions + Number animations",
    "anti_patterns": "Playful design + Unclear fees + AI purple/pink gradients",
    "severity": "HIGH"
  },
  {
    "category": "Social Media App",
    "pattern": "Feature-Rich Showcase",
    "style": "Vibrant & Block-based + Motion-Driven",
    "color_mood": "Vibrant + Engagement colors",
    "typography_mood": "Modern + Bold typography",
    "effects": "Large scroll animations + Icon animations",
    "anti_patterns": "Heavy skeuomorphism + Accessibility ignored",
    "severity": "MEDIUM"
  },
  {
    "category": "Productivity Tool",
    "pattern": "Interactive Demo + Feature-Rich",
    "style": "Flat Design + Micro-interactions",
    "color_mood": "Clear hierarchy + Functional colors",
    "typography_mood": "Clean + Efficient typography",
    "effects": "Quick actions (150ms) + Task animations",
    "anti_patterns": "Complex onboarding + Slow performance",
    "severity": "HIGH"
  },
  {
    "category": "Design System/Component Library",
    "pattern": "Feature-Rich + Documentation",
    "style": "Minimalism + Accessible & Ethical",
    "color_mood": "Clear hierarchy + Code-like structure",
    "typography_mood": "Monospace + Clear typography",
    "effects": "Code copy animations + Component previews",
    "anti_patterns": "Poor documentation + No live preview",
    "severity": "HIGH"
  },
  {
    "category": "AI/Chatbot Platform",
    "pattern": "Interactive Demo + Minimal",
    "style": "AI-Native UI + Minimalism",
    "color_mood": "Neutral + AI Purple (#6366F1)",
    "typography_mood": "Modern + Clear typography",
    "effects": "Streaming text + Typing indicators + Fade-in",
    "anti_patterns": "Heavy chrome + Slow response feedback",
    "severity": "HIGH"
  },
  {
    "category": "NFT/Web3 Platform",
    "pattern": "Feature-Rich Showcase",
    "style": "Cyberpunk UI + Glassmorphism",
    "color_mood": "Dark + Neon + Gold (#FFD700)",
    "typography_mood": "Bold + Modern typography",
    "effects": "Wallet connect animations + Transaction feedback",
    "anti_patterns": "Light mode default + No transaction status",
    "severity": "HIGH"
  },
  {
    "category": "Creator Economy Platform",
    "pattern": "Social Proof + Feature-Rich",
    "style": "Vibrant & Block-based + Bento Box Grid",
    "color_mood": "Vibrant + Brand colors",
    "typography_mood": "Modern + Bold typography",
    "effects": "Engagement counter animations + Profile reveals",
    "anti_patterns": "Generic layout + Hidden earnings",
    "severity": "MEDIUM"
  },
  {
    "category": "Remote Work/Collaboration Tool",
    "pattern": "Feature-Rich + Real-Time",
    "style": "Soft UI Evolution + Minimalism",
    "color_mood": "Calm Blue + Neutral grey",
    "typography_mood": "Clean + Readable typography",
    "effects": "Real-time presence indicators + Notification badges",
    "anti_patterns": "Cluttered interface + No presence",
    "severity": "HIGH"
  },
  {
    "category": "Mental Health App",
    "pattern": "Social Proof-Focused",
    "style": "Neumorphism + Accessible & Ethical",
    "color_mood": "Calm Pastels + Trust colors",
    "typography_mood": "Calming + Readable typography",
    "effects": "Soft press + Breathing animations",
    "anti_patterns": "Bright neon + Motion overload",
    "severity": "HIGH"
  },
  {
    "category": "Pet Tech App",
    "pattern": "Storytelling + Feature-Rich",
    "style": "Claymorphism + Vibrant & Block-based",
    "color_mood": "Playful + Warm colors",
    "typography_mood": "Friendly + Playful typography",
    "effects": "Pet profile animations + Health tracking charts",
    "anti_patterns": "Generic design + No personality",
    "severity": "MEDIUM"
  },
  {
    "category": "Smart Home/IoT Dashboard",
    "pattern": "Real-Time Monitoring",
    "style": "Glassmorphism + Dark Mode (OLED)",
    "color_mood": "Dark + Status indicator colors",
    "typography_mood": "Clear + Functional typography",
    "effects": "Device status pulse + Quick action animations",
    "anti_patterns": "Slow updates + No automation",
    "severity": "HIGH"
  },
  {
    "category": "EV/Charging Ecosystem",
    "pattern": "Hero-Centric + Feature-Rich",
    "style": "Minimalism + Aurora UI",
    "color_mood": "Electric Blue (#009CD1) + Green",
    "typography_mood": "Modern + Clear typography",
    "effects": "Range estimation animations + Map interactions",
    "anti_patterns": "Poor map UX + Hidden costs",
    "severity": "HIGH"
  },
  {
    "category": "Subscription Box Service",
    "pattern": "Feature-Rich + Conversion",
    "style": "Vibrant & Block-based + Motion-Driven",
    "color_mood": "Brand + Excitement colors",
    "typography_mood": "Engaging + Clear typography",
    "effects": "Unboxing reveal animations + Product carousel",
    "anti_patterns": "Confusing pricing + No unboxing preview",
    "severity": "HIGH"
  },
  {
    "category": "Podcast Platform",
    "pattern": "Storytelling + Feature-Rich",
    "style": "Dark Mode (OLED) + Minimalism",
    "color_mood": "Dark + Audio waveform accents",
    "typography_mood": "Modern + Clear typography",
    "effects": "Waveform visualizations + Episode transitions",
    "anti_patterns": "Poor audio player + Cluttered layout",
    "severity": "HIGH"
  },
  {
    "category": "Dating App",
    "pattern": "Social Proof + Feature-Rich",
    "style": "Vibrant & Block-based + Motion-Driven",
    "color_mood": "Warm + Romantic (Pink/Red gradients)",
    "typography_mood": "Modern + Friendly typography",
    "effects": "Profile card swipe + Match animations",
    "anti_patterns": "Generic profiles + No safety",
    "severity": "HIGH"
  },
  {
    "category": "Micro-Credentials/Badges Platform",
    "pattern": "Trust & Authority + Feature",
    "style": "Minimalism + Flat Design",
    "color_mood": "Trust Blue + Gold (#FFD700)",
    "typography_mood": "Professional + Clear typography",
    "effects": "Badge reveal animations + Progress tracking",
    "anti_patterns": "No verification + Hidden progress",
    "severity": "MEDIUM"
  },
  {
    "category": "Knowledge Base/Documentation",
    "pattern": "FAQ + Minimal",
    "style": "Minimalism + Accessible & Ethical",
    "color_mood": "Clean hierarchy + Minimal color",
    "typography_mood": "Clear + Readable typography",
    "effects": "Search highlight + Smooth scrolling",
    "anti_patterns": "Poor navigation + No search",
    "severity": "HIGH"
  },
  {
    "category": "Hyperlocal Services",
    "pattern": "Conversion + Feature-Rich",
    "style": "Minimalism + Vibrant & Block-based",
    "color_mood": "Location markers + Trust colors",
    "typography_mood": "Clear + Functional typography",
    "effects": "Map hover + Provider card reveals",
    "anti_patterns": "No map + Hidden reviews",
    "severity": "HIGH"
  },
  {
    "category": "Beauty/Spa/Wellness Service",
    "pattern": "Hero-Centric + Social Proof",
    "style": "Soft UI Evolution + Neumorphism",
    "color_mood": "Soft pastels (Pink Sage Cream) + Gold accents",
    "typography_mood": "Elegant + Calming typography",
    "effects": "Soft shadows + Smooth transitions (200-300ms) + Gentle hover",
    "anti_patterns": "Bright neon colors + Harsh animations + Dark mode",
    "severity": "HIGH"
  },
  {
    "category": "Luxury/Premium Brand",
    "pattern": "Storytelling + Feature-Rich",
    "style": "Liquid Glass + Glassmorphism",
    "color_mood": "Black + Gold (#FFD700) + White",
    "typography_mood": "Elegant + Refined typography",
    "effects": "Slow parallax + Premium reveals (400-600ms)",
    "anti_patterns": "Cheap visuals + Fast animations",
    "severity": "HIGH"
  },
  {
    "category": "Restaurant/Food Service",
    "pattern": "Hero-Centric + Conversion",
    "style": "Vibrant & Block-based + Motion-Driven",
    "color_mood": "Warm colors (Orange Red Brown)",
    "typography_mood": "Appetizing + Clear typography",
    "effects": "Food image reveal + Menu hover effects",
    "anti_patterns": "Low-quality imagery + Outdated hours",
    "severity": "HIGH"
  },
  {
    "category": "Fitness/Gym App",
    "pattern": "Feature-Rich + Data",
    "style": "Vibrant & Block-based + Dark Mode (OLED)",
    "color_mood": "Energetic (Orange #FF6B35) + Dark bg",
    "typography_mood": "Bold + Motivational typography",
    "effects": "Progress ring animations + Achievement unlocks",
    "anti_patterns": "Static design + No gamification",
    "severity": "HIGH"
  },
  {
    "category": "Real Estate/Property",
    "pattern": "Hero-Centric + Feature-Rich",
    "style": "Glassmorphism + Minimalism",
    "color_mood": "Trust Blue + Gold + White",
    "typography_mood": "Professional + Confident",
    "effects": "3D property tour zoom + Map hover",
    "anti_patterns": "Poor photos + No virtual tours",
    "severity": "HIGH"
  },
  {
    "category": "Travel/Tourism Agency",
    "pattern": "Storytelling-Driven + Hero",
    "style": "Aurora UI + Motion-Driven",
    "color_mood": "Vibrant destination + Sky Blue",
    "typography_mood": "Inspirational + Engaging",
    "effects": "Destination parallax + Itinerary animations",
    "anti_patterns": "Generic photos + Complex booking",
    "severity": "HIGH"
  },
  {
    "category": "Hotel/Hospitality",
    "pattern": "Hero-Centric + Social Proof",
    "style": "Liquid Glass + Minimalism",
    "color_mood": "Warm neutrals + Gold (#D4AF37)",
    "typography_mood": "Elegant + Welcoming typography",
    "effects": "Room gallery + Amenity reveals",
    "anti_patterns": "Poor photos + Complex booking",
    "severity": "HIGH"
  },
  {
    "category": "Wedding/Event Planning",
    "pattern": "Storytelling + Social Proof",
    "style": "Soft UI Evolution + Aurora UI",
    "color_mood": "Soft Pink (#FFD6E0) + Gold + Cream",
    "typography_mood": "Elegant + Romantic typography",
    "effects": "Gallery reveals + Timeline animations",
    "anti_patterns": "Generic templates + No portfolio",
    "severity": "HIGH"
  },
  {
    "category": "Legal Services",
    "pattern": "Trust & Authority + Minimal",
    "style": "Trust & Authority + Minimalism",
    "color_mood": "Navy Blue (#1E3A5F) + Gold + White",
    "typography_mood": "Professional + Authoritative typography",
    "effects": "Practice area reveal + Attorney profile animations",
    "anti_patterns": "Outdated design + Hidden credentials + AI purple/pink gradients",
    "severity": "HIGH"
  },
  {
    "category": "Insurance Platform",
    "pattern": "Conversion + Trust",
    "style": "Trust & Authority + Flat Design",
    "color_mood": "Trust Blue (#0066CC) + Green + Neutral",
    "typography_mood": "Clear + Professional typography",
    "effects": "Quote calculator animations + Policy comparison",
    "anti_patterns": "Confusing pricing + No trust signals + AI purple/pink gradients",
    "severity": "HIGH"
  },
  {
    "category": "Banking/Traditional Finance",
    "pattern": "Trust & Authority + Feature",
    "style": "Minimalism + Accessible & Ethical",
    "color_mood": "Navy (#0A1628) + Trust Blue + Gold",
    "typography_mood": "Professional + Trustworthy typography",
    "effects": "Smooth number animations + Security indicators",
    "anti_patterns": "Playful design + Poor security UX + AI purple/pink gradients",
    "severity": "HIGH"
  },
  {
    "category": "Online Course/E-learning",
    "pattern": "Feature-Rich + Social Proof",
    "style": "Claymorphism + Vibrant & Block-based",
    "color_mood": "Vibrant learning colors + Progress green",
    "typography_mood": "Friendly + Engaging typography",
    "effects": "Progress bar animations + Certificate reveals",
    "anti_patterns": "Boring design + No gamification",
    "severity": "HIGH"
  },
  {
    "category": "Non-profit/Charity",
    "pattern": "Storytelling + Trust",
    "style": "Accessible & Ethical + Organic Biophilic",
    "color_mood": "Cause-related colors + Trust + Warm",
    "typography_mood": "Heartfelt + Readable typography",
    "effects": "Impact counter animations + Story reveals",
    "anti_patterns": "No impact data + Hidden financials",
    "severity": "HIGH"
  },
  {
    "category": "Music Streaming",
    "pattern": "Feature-Rich Showcase",
    "style": "Dark Mode (OLED) + Vibrant & Block-based",
    "color_mood": "Dark (#121212) + Vibrant accents + Album art colors",
    "typography_mood": "Modern + Bold typography",
    "effects": "Waveform visualization + Playlist animations",
    "anti_patterns": "Cluttered layout + Poor audio player UX",
    "severity": "HIGH"
  },
  {
    "category": "Video Streaming/OTT",
    "pattern": "Hero-Centric + Feature-Rich",
    "style": "Dark Mode (OLED) + Motion-Driven",
    "color_mood": "Dark bg + Poster colors + Brand accent",
    "typography_mood": "Bold + Engaging typography",
    "effects": "Video player animations + Content carousel (parallax)",
    "anti_patterns": "Static layout + Slow video player",
    "severity": "HIGH"
  },
  {
    "category": "Job Board/Recruitment",
    "pattern": "Conversion-Optimized + Feature-Rich",
    "style": "Flat Design + Minimalism",
    "color_mood": "Professional Blue + Success Green + Neutral",
    "typography_mood": "Clear + Professional typography",
    "effects": "Search/filter animations + Application flow",
    "anti_patterns": "Outdated forms + Hidden filters",
    "severity": "HIGH"
  },
  {
    "category": "Marketplace (P2P)",
    "pattern": "Feature-Rich Showcase + Social Proof",
    "style": "Vibrant & Block-based + Flat Design",
    "color_mood": "Trust colors + Category colors + Success green",
    "typography_mood": "Modern + Engaging typography",
    "effects": "Review star animations + Listing hover effects",
    "anti_patterns": "Low trust signals + Confusing layout",
    "severity": "HIGH"
  },
  {
    "category": "Logistics/Delivery",
    "pattern": "Feature-Rich Showcase + Real-Time",
    "style": "Minimalism + Flat Design",
    "color_mood": "Blue (#2563EB) + Orange (tracking) + Green",
    "typography_mood": "Clear + Functional typography",
    "effects": "Real-time tracking animation + Status pulse",
    "anti_patterns": "Static tracking + No map integration + AI purple/pink gradients",
    "severity": "HIGH"
  },
  {
    "category": "Agriculture/Farm Tech",
    "pattern": "Feature-Rich Showcase",
    "style": "Organic Biophilic + Flat Design",
    "color_mood": "Earth Green (#4A7C23) + Brown + Sky Blue",
    "typography_mood": "Clear + Informative typography",
    "effects": "Data visualization + Weather animations",
    "anti_patterns": "Generic design + Ignored accessibility + AI purple/pink gradients",
    "severity": "MEDIUM"
  },
  {
    "category": "Construction/Architecture",
    "pattern": "Hero-Centric + Feature-Rich",
    "style": "Minimalism + 3D & Hyperrealism",
    "color_mood": "Grey (#4A4A4A) + Orange (safety) + Blueprint Blue",
    "typography_mood": "Professional + Bold typography",
    "effects": "3D model viewer + Timeline animations",
    "anti_patterns": "2D-only layouts + Poor image quality + AI purple/pink gradients",
    "severity": "HIGH"
  },
  {
    "category": "Automotive/Car Dealership",
    "pattern": "Hero-Centric + Feature-Rich",
    "style": "Motion-Driven + 3D & Hyperrealism",
    "color_mood": "Brand colors + Metallic + Dark/Light",
    "typography_mood": "Bold + Confident typography",
    "effects": "360 product view + Configurator animations",
    "anti_patterns": "Static product pages + Poor UX",
    "severity": "HIGH"
  },
  {
    "category": "Photography Studio",
    "pattern": "Storytelling-Driven + Hero-Centric",
    "style": "Motion-Driven + Minimalism",
    "color_mood": "Black + White + Minimal accent",
    "typography_mood": "Elegant + Minimal typography",
    "effects": "Full-bleed gallery + Before/after reveal",
    "anti_patterns": "Heavy text + Poor image showcase",
    "severity": "HIGH"
  },
  {
    "category": "Coworking Space",
    "pattern": "Hero-Centric + Feature-Rich",
    "style": "Vibrant & Block-based + Glassmorphism",
    "color_mood": "Energetic colors + Wood tones + Brand",
    "typography_mood": "Modern + Engaging typography",
    "effects": "Space tour video + Amenity reveal animations",
    "anti_patterns": "Outdated photos + Confusing layout",
    "severity": "MEDIUM"
  },
  {
    "category": "Home Services (Plumber/Electrician)",
    "pattern": "Conversion-Optimized + Trust",
    "style": "Flat Design + Trust & Authority",
    "color_mood": "Trust Blue + Safety Orange + Grey",
    "typography_mood": "Professional + Clear typography",
    "effects": "Emergency contact highlight + Service menu animations",
    "anti_patterns": "Hidden contact info + No certifications",
    "severity": "HIGH"
  },
  {
    "category": "Childcare/Daycare",
    "pattern": "Social Proof-Focused + Trust",
    "style": "Claymorphism + Vibrant & Block-based",
    "color_mood": "Playful pastels + Safe colors + Warm",
    "typography_mood": "Friendly + Playful typography",
    "effects": "Parent portal animations + Activity gallery reveal",
    "anti_patterns": "Generic design + Hidden safety info",
    "severity": "HIGH"
  },
  {
    "category": "Senior Care/Elderly",
    "pattern": "Trust & Authority + Accessible",
    "style": "Accessible & Ethical + Soft UI Evolution",
    "color_mood": "Calm Blue + Warm neutrals + Large text",
    "typography_mood": "Large + Clear typography (18px+)",
    "effects": "Large touch targets + Clear navigation",
    "anti_patterns": "Small text + Complex navigation + AI purple/pink gradients",
    "severity": "HIGH"
  },
  {
    "category": "Medical Clinic",
    "pattern": "Trust & Authority + Conversion",
    "style": "Accessible & Ethical + Minimalism",
    "color_mood": "Medical Blue (#0077B6) + Trust White",
    "typography_mood": "Professional + Readable typography",
    "effects": "Online booking flow + Doctor profile reveals",
    "anti_patterns": "Outdated interface + Confusing booking + AI purple/pink gradients",
    "severity": "HIGH"
  },
  {
    "category": "Pharmacy/Drug Store",
    "pattern": "Conversion-Optimized + Trust",
    "style": "Flat Design + Accessible & Ethical",
    "color_mood": "Pharmacy Green + Trust Blue + Clean White",
    "typography_mood": "Clear + Functional typography",
    "effects": "Prescription upload flow + Refill reminders",
    "anti_patterns": "Confusing layout + Privacy concerns + AI purple/pink gradients",
    "severity": "HIGH"
  },
  {
    "category": "Dental Practice",
    "pattern": "Social Proof-Focused + Conversion",
    "style": "Soft UI Evolution + Minimalism",
    "color_mood": "Fresh Blue + White + Smile Yellow",
    "typography_mood": "Friendly + Professional typography",
    "effects": "Before/after gallery + Patient testimonial carousel",
    "anti_patterns": "Poor imagery + No testimonials",
    "severity": "HIGH"
  },
  {
    "category": "Veterinary Clinic",
    "pattern": "Social Proof-Focused + Trust",
    "style": "Claymorphism + Accessible & Ethical",
    "color_mood": "Caring Blue + Pet colors + Warm",
    "typography_mood": "Friendly + Welcoming typography",
    "effects": "Pet profile management + Service animations",
    "anti_patterns": "Generic design + Hidden services",
    "severity": "MEDIUM"
  },
  {
    "category": "Florist/Plant Shop",
    "pattern": "Hero-Centric + Conversion",
    "style": "Organic Biophilic + Vibrant & Block-based",
    "color_mood": "Natural Green + Floral pinks/purples",
    "typography_mood": "Elegant + Natural typography",
    "effects": "Product reveal + Seasonal transitions",
    "anti_patterns": "Poor imagery + No seasonal content",
    "severity": "MEDIUM"
  },
  {
    "category": "Bakery/Cafe",
    "pattern": "Hero-Centric + Conversion",
    "style": "Vibrant & Block-based + Soft UI Evolution",
    "color_mood": "Warm Brown + Cream + Appetizing accents",
    "typography_mood": "Warm + Inviting typography",
    "effects": "Menu hover + Order animations",
    "anti_patterns": "Poor food photos + Hidden hours",
    "severity": "HIGH"
  },
  {
    "category": "Brewery/Winery",
    "pattern": "Storytelling + Hero-Centric",
    "style": "Motion-Driven + Storytelling-Driven",
    "color_mood": "Deep amber/burgundy + Gold + Craft",
    "typography_mood": "Artisanal + Heritage typography",
    "effects": "Tasting note reveals + Heritage timeline",
    "anti_patterns": "Generic product pages + No story",
    "severity": "HIGH"
  },
  {
    "category": "Airline",
    "pattern": "Conversion + Feature-Rich",
    "style": "Minimalism + Glassmorphism",
    "color_mood": "Sky Blue + Brand colors + Trust",
    "typography_mood": "Clear + Professional typography",
    "effects": "Flight search animations + Boarding pass reveals",
    "anti_patterns": "Complex booking + Poor mobile",
    "severity": "HIGH"
  },
  {
    "category": "News/Media Platform",
    "pattern": "Hero-Centric + Feature-Rich",
    "style": "Minimalism + Flat Design",
    "color_mood": "Brand colors + High contrast",
    "typography_mood": "Clear + Readable typography",
    "effects": "Breaking news badge + Article reveal animations",
    "anti_patterns": "Cluttered layout + Slow loading",
    "severity": "HIGH"
  },
  {
    "category": "Magazine/Blog",
    "pattern": "Storytelling + Hero-Centric",
    "style": "Swiss Modernism 2.0 + Motion-Driven",
    "color_mood": "Editorial colors + Brand + Clean white",
    "typography_mood": "Editorial + Elegant typography",
    "effects": "Article transitions + Category reveals",
    "anti_patterns": "Poor typography + Slow loading",
    "severity": "HIGH"
  },
  {
    "category": "Freelancer Platform",
    "pattern": "Feature-Rich + Conversion",
    "style": "Flat Design + Minimalism",
    "color_mood": "Professional Blue + Success Green",
    "typography_mood": "Clear + Professional typography",
    "effects": "Skill match animations + Review reveals",
    "anti_patterns": "Poor profiles + No reviews",
    "severity": "HIGH"
  },
  {
    "category": "Marketing Agency",
    "pattern": "Storytelling + Feature-Rich",
    "style": "Brutalism + Motion-Driven",
    "color_mood": "Bold brand colors + Creative freedom",
    "typography_mood": "Bold + Expressive typography",
    "effects": "Portfolio reveals + Results animations",
    "anti_patterns": "Boring design + Hidden work",
    "severity": "HIGH"
  },
  {
    "category": "Event Management",
    "pattern": "Hero-Centric + Feature-Rich",
    "style": "Vibrant & Block-based + Motion-Driven",
    "color_mood": "Event theme colors + Excitement accents",
    "typography_mood": "Bold + Engaging typography",
    "effects": "Countdown timer + Registration flow",
    "anti_patterns": "Confusing registration + No countdown",
    "severity": "HIGH"
  },
  {
    "category": "Membership/Community",
    "pattern": "Social Proof + Conversion",
    "style": "Vibrant & Block-based + Soft UI Evolution",
    "color_mood": "Community brand colors + Engagement",
    "typography_mood": "Friendly + Engaging typography",
    "effects": "Member counter + Benefit reveals",
    "anti_patterns": "Hidden benefits + No community proof",
    "severity": "HIGH"
  },
  {
    "category": "Newsletter Platform",
    "pattern": "Minimal + Conversion",
    "style": "Minimalism + Flat Design",
    "color_mood": "Brand primary + Clean white + CTA",
    "typography_mood": "Clean + Readable typography",
    "effects": "Subscribe form + Archive reveals",
    "anti_patterns": "Complex signup + No preview",
    "severity": "MEDIUM"
  },
  {
    "category": "Digital Products/Downloads",
    "pattern": "Feature-Rich + Conversion",
    "style": "Vibrant & Block-based + Motion-Driven",
    "color_mood": "Product colors + Brand + Success green",
    "typography_mood": "Modern + Clear typography",
    "effects": "Product preview + Instant delivery animations",
    "anti_patterns": "No preview + Slow delivery",
    "severity": "HIGH"
  },
  {
    "category": "Church/Religious Organization",
    "pattern": "Hero-Centric + Social Proof",
    "style": "Accessible & Ethical + Soft UI Evolution",
    "color_mood": "Warm Gold + Deep Purple/Blue + White",
    "typography_mood": "Welcoming + Clear typography",
    "effects": "Service time highlights + Event calendar",
    "anti_patterns": "Outdated design + Hidden info",
    "severity": "MEDIUM"
  },
  {
    "category": "Sports Team/Club",
    "pattern": "Hero-Centric + Feature-Rich",
    "style": "Vibrant & Block-based + Motion-Driven",
    "color_mood": "Team colors + Energetic accents",
    "typography_mood": "Bold + Impactful typography",
    "effects": "Score animations + Schedule reveals",
    "anti_patterns": "Static content + Poor fan engagement",
    "severity": "HIGH"
  },
  {
    "category": "Museum/Gallery",
    "pattern": "Storytelling + Feature-Rich",
    "style": "Minimalism + Motion-Driven",
    "color_mood": "Art-appropriate neutrals + Exhibition accents",
    "typography_mood": "Elegant + Minimal typography",
    "effects": "Virtual tour + Collection reveals",
    "anti_patterns": "Cluttered layout + No online access",
    "severity": "HIGH"
  },
  {
    "category": "Theater/Cinema",
    "pattern": "Hero-Centric + Conversion",
    "style": "Dark Mode (OLED) + Motion-Driven",
    "color_mood": "Dark + Spotlight accents + Gold",
    "typography_mood": "Dramatic + Bold typography",
    "effects": "Seat selection + Trailer reveals",
    "anti_patterns": "Poor booking UX + No trailers",
    "severity": "HIGH"
  },
  {
    "category": "Language Learning App",
    "pattern": "Feature-Rich + Social Proof",
    "style": "Claymorphism + Vibrant & Block-based",
    "color_mood": "Playful colors + Progress indicators",
    "typography_mood": "Friendly + Clear typography",
    "effects": "Progress animations + Achievement unlocks",
    "anti_patterns": "Boring design + No motivation",
    "severity": "HIGH"
  },
  {
    "category": "Coding Bootcamp",
    "pattern": "Feature-Rich + Social Proof",
    "style": "Dark Mode (OLED) + Minimalism",
    "color_mood": "Code editor colors + Brand + Success",
    "typography_mood": "Technical + Clear typography",
    "effects": "Terminal animations + Career outcome reveals",
    "anti_patterns": "Light mode only + Hidden results",
    "severity": "HIGH"
  },
  {
    "category": "Cybersecurity Platform",
    "pattern": "Trust & Authority + Real-Time",
    "style": "Cyberpunk UI + Dark Mode (OLED)",
    "color_mood": "Matrix Green (#00FF00) + Deep Black",
    "typography_mood": "Technical + Clear typography",
    "effects": "Threat visualization + Alert animations",
    "anti_patterns": "Light mode + Poor data viz",
    "severity": "HIGH"
  },
  {
    "category": "Developer Tool / IDE",
    "pattern": "Minimal + Documentation",
    "style": "Dark Mode (OLED) + Minimalism",
    "color_mood": "Dark syntax theme + Blue focus",
    "typography_mood": "Monospace + Functional typography",
    "effects": "Syntax highlighting + Command palette",
    "anti_patterns": "Light mode default + Slow performance",
    "severity": "HIGH"
  },
  {
    "category": "Biotech / Life Sciences",
    "pattern": "Storytelling + Data",
    "style": "Glassmorphism + Clean Science",
    "color_mood": "Sterile White + DNA Blue + Life Green",
    "typography_mood": "Scientific + Clear typography",
    "effects": "Data visualization + Research reveals",
    "anti_patterns": "Cluttered data + Poor credibility",
    "severity": "HIGH"
  },
  {
    "category": "Space Tech / Aerospace",
    "pattern": "Immersive + Feature-Rich",
    "style": "Holographic/HUD + Dark Mode",
    "color_mood": "Deep Space Black + Star White + Metallic",
    "typography_mood": "Futuristic + Precise typography",
    "effects": "Telemetry animations + 3D renders",
    "anti_patterns": "Generic design + No immersion",
    "severity": "HIGH"
  },
  {
    "category": "Architecture / Interior",
    "pattern": "Portfolio + Hero-Centric",
    "style": "Exaggerated Minimalism + High Imagery",
    "color_mood": "Monochrome + Gold Accent + High Imagery",
    "typography_mood": "Architectural + Elegant typography",
    "effects": "Project gallery + Blueprint reveals",
    "anti_patterns": "Poor imagery + Cluttered layout",
    "severity": "HIGH"
  },
  {
    "category": "Quantum Computing Interface",
    "pattern": "Immersive + Interactive",
    "style": "Holographic/HUD + Dark Mode",
    "color_mood": "Quantum Blue (#00FFFF) + Deep Black",
    "typography_mood": "Futuristic + Scientific typography",
    "effects": "Probability visualizations + Qubit state animations",
    "anti_patterns": "Generic tech design + No viz",
    "severity": "HIGH"
  },
  {
    "category": "Biohacking / Longevity App",
    "pattern": "Data-Dense + Storytelling",
    "style": "Biomimetic/Organic 2.0 + Minimalism",
    "color_mood": "Cellular Pink/Red + DNA Blue + White",
    "typography_mood": "Scientific + Clear typography",
    "effects": "Biological data viz + Progress animations",
    "anti_patterns": "Generic health app + No privacy",
    "severity": "HIGH"
  },
  {
    "category": "Autonomous Drone Fleet Manager",
    "pattern": "Real-Time + Feature-Rich",
    "style": "HUD/Sci-Fi FUI + Real-Time",
    "color_mood": "Tactical Green + Alert Red + Map Dark",
    "typography_mood": "Technical + Functional typography",
    "effects": "Telemetry animations + 3D spatial awareness",
    "anti_patterns": "Slow updates + Poor spatial viz",
    "severity": "HIGH"
  },
  {
    "category": "Generative Art Platform",
    "pattern": "Showcase + Feature-Rich",
    "style": "Minimalism + Gen Z Chaos",
    "color_mood": "Neutral (#F5F5F5) + User Content",
    "typography_mood": "Minimal + Content-focused typography",
    "effects": "Gallery masonry + Minting animations",
    "anti_patterns": "Heavy chrome + Slow loading",
    "severity": "HIGH"
  },
  {
    "category": "Spatial Computing OS / App",
    "pattern": "Immersive + Interactive",
    "style": "Spatial UI (VisionOS) + Glassmorphism",
    "color_mood": "Frosted Glass + System Colors + Depth",
    "typography_mood": "Spatial + Readable typography",
    "effects": "Depth hierarchy + Gaze interactions",
    "anti_patterns": "2D design + No spatial depth",
    "severity": "HIGH"
  },
  {
    "category": "Sustainable Energy / Climate Tech",
    "pattern": "Data + Trust",
    "style": "Organic Biophilic + E-Ink/Paper",
    "color_mood": "Earth Green + Sky Blue + Solar Yellow",
    "typography_mood": "Clear + Informative typography",
    "effects": "Impact viz + Progress animations",
    "anti_patterns": "Greenwashing + No real data",
    "severity": "HIGH"
  },
  {
    "category": "Personal Finance Tracker",
    "pattern": "Interactive Product Demo",
    "style": "Glassmorphism + Dark Mode (OLED)",
    "color_mood": "Calm blue + success green + alert red + chart accents",
    "typography_mood": "Modern + Clear hierarchy",
    "effects": "Backdrop blur (10-20px) + Translucent overlays",
    "anti_patterns": "Pure white backgrounds",
    "severity": "HIGH"
  },
  {
    "category": "Chat & Messaging App",
    "pattern": "Feature-Rich Showcase + Demo",
    "style": "Minimalism + Micro-interactions",
    "color_mood": "Brand primary + bubble contrast (sender/receiver) + typing grey",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Subtle hover 200ms + Smooth transitions + Clean",
    "anti_patterns": "Excessive decoration",
    "severity": "HIGH"
  },
  {
    "category": "Notes & Writing App",
    "pattern": "Minimal & Direct",
    "style": "Minimalism + Flat Design",
    "color_mood": "Clean white/cream + minimal accent + editor syntax colors",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Color shift hover + Fast 150ms transitions + No shadows",
    "anti_patterns": "Excessive decoration + Complex shadows + 3D effects",
    "severity": "HIGH"
  },
  {
    "category": "Habit Tracker",
    "pattern": "Social Proof-Focused + Demo",
    "style": "Claymorphism + Vibrant & Block-based",
    "color_mood": "Streak warm (amber/orange) + progress green + motivational accents",
    "typography_mood": "Playful + Rounded + Friendly",
    "effects": "Multi-layer shadows + Spring bounce + Soft press 200ms",
    "anti_patterns": "Muted colors + Low energy",
    "severity": "HIGH"
  },
  {
    "category": "Food Delivery / On-Demand",
    "pattern": "Hero-Centric Design + Feature-Rich",
    "style": "Vibrant & Block-based + Motion-Driven",
    "color_mood": "Appetizing warm (orange/red) + trust blue + map accent",
    "typography_mood": "Energetic + Bold + Large",
    "effects": "Scroll animations + Parallax + Page transitions",
    "anti_patterns": "Muted colors + Low energy",
    "severity": "HIGH"
  },
  {
    "category": "Ride Hailing / Transportation",
    "pattern": "Conversion-Optimized + Demo",
    "style": "Minimalism + Glassmorphism",
    "color_mood": "Brand primary + map neutral + status indicator colors",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Backdrop blur (10-20px) + Translucent overlays",
    "anti_patterns": "Excessive decoration",
    "severity": "HIGH"
  },
  {
    "category": "Recipe & Cooking App",
    "pattern": "Hero-Centric Design + Feature-Rich",
    "style": "Claymorphism + Vibrant & Block-based",
    "color_mood": "Warm food tones (terracotta/sage/cream) + appetizing imagery",
    "typography_mood": "Playful + Rounded + Friendly",
    "effects": "Multi-layer shadows + Spring bounce + Soft press 200ms",
    "anti_patterns": "Muted colors + Low energy",
    "severity": "HIGH"
  },
  {
    "category": "Meditation & Mindfulness",
    "pattern": "Storytelling-Driven + Social Proof",
    "style": "Neumorphism + Soft UI Evolution",
    "color_mood": "Ultra-calm pastels (lavender/sage/sky) + breathing animation gradient",
    "typography_mood": "Subtle + Soft + Monochromatic",
    "effects": "Dual shadows (light+dark) + Soft press 150ms",
    "anti_patterns": "Inconsistent styling + Poor contrast ratios",
    "severity": "HIGH"
  },
  {
    "category": "Weather App",
    "pattern": "Hero-Centric Design",
    "style": "Glassmorphism + Aurora UI",
    "color_mood": "Atmospheric gradients (sky blue → sunset → storm grey) + temp scale",
    "typography_mood": "Modern + Clear hierarchy",
    "effects": "Backdrop blur (10-20px) + Translucent overlays",
    "anti_patterns": "Inconsistent styling + Poor contrast ratios",
    "severity": "HIGH"
  },
  {
    "category": "Diary & Journal App",
    "pattern": "Storytelling-Driven",
    "style": "Soft UI Evolution + Minimalism",
    "color_mood": "Warm paper tones (cream/linen) + muted ink + mood-coded accents",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Subtle hover 200ms + Smooth transitions + Clean",
    "anti_patterns": "Excessive decoration",
    "severity": "HIGH"
  },
  {
    "category": "CRM & Client Management",
    "pattern": "Feature-Rich Showcase + Demo",
    "style": "Flat Design + Minimalism",
    "color_mood": "Professional blue + pipeline stage colors + closed-won green",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Color shift hover + Fast 150ms transitions + No shadows",
    "anti_patterns": "Excessive decoration + Complex shadows + 3D effects",
    "severity": "HIGH"
  },
  {
    "category": "Inventory & Stock Management",
    "pattern": "Feature-Rich Showcase",
    "style": "Flat Design + Minimalism",
    "color_mood": "Functional neutral + status traffic-light (green/amber/red) + scanner accent",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Color shift hover + Fast 150ms transitions + No shadows",
    "anti_patterns": "Excessive decoration + Complex shadows + 3D effects",
    "severity": "HIGH"
  },
  {
    "category": "Flashcard & Study Tool",
    "pattern": "Feature-Rich Showcase + Demo",
    "style": "Claymorphism + Micro-interactions",
    "color_mood": "Playful primary + correct green + incorrect red + progress blue",
    "typography_mood": "Playful + Rounded + Friendly",
    "effects": "Multi-layer shadows + Spring bounce + Soft press 200ms",
    "anti_patterns": "Inconsistent styling + Poor contrast ratios",
    "severity": "HIGH"
  },
  {
    "category": "Booking & Appointment App",
    "pattern": "Conversion-Optimized",
    "style": "Soft UI Evolution + Flat Design",
    "color_mood": "Trust blue + available green + booked grey + confirm accent",
    "typography_mood": "Bold + Clean + Sans-serif",
    "effects": "Color shift hover + Fast 150ms transitions + No shadows",
    "anti_patterns": "Complex shadows + 3D effects",
    "severity": "HIGH"
  },
  {
    "category": "Invoice & Billing Tool",
    "pattern": "Conversion-Optimized + Trust",
    "style": "Minimalism + Flat Design",
    "color_mood": "Professional navy + paid green + overdue red + neutral grey",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Color shift hover + Fast 150ms transitions + No shadows",
    "anti_patterns": "Excessive decoration + Complex shadows + 3D effects",
    "severity": "HIGH"
  },
  {
    "category": "Grocery & Shopping List",
    "pattern": "Minimal & Direct + Demo",
    "style": "Flat Design + Vibrant & Block-based",
    "color_mood": "Fresh green + food-category colors + checkmark accent",
    "typography_mood": "Bold + Clean + Sans-serif",
    "effects": "Color shift hover + Fast 150ms transitions + No shadows",
    "anti_patterns": "Complex shadows + 3D effects + Muted colors + Low energy",
    "severity": "HIGH"
  },
  {
    "category": "Timer & Pomodoro",
    "pattern": "Minimal & Direct",
    "style": "Minimalism + Neumorphism",
    "color_mood": "High-contrast on dark + focus red/amber + break green",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Dual shadows (light+dark) + Soft press 150ms",
    "anti_patterns": "Excessive decoration",
    "severity": "HIGH"
  },
  {
    "category": "Parenting & Baby Tracker",
    "pattern": "Social Proof-Focused + Trust",
    "style": "Claymorphism + Soft UI Evolution",
    "color_mood": "Soft pastels (baby pink/sky blue/mint/peach) + warm accents",
    "typography_mood": "Playful + Rounded + Friendly",
    "effects": "Multi-layer shadows + Spring bounce + Soft press 200ms",
    "anti_patterns": "Inconsistent styling + Poor contrast ratios",
    "severity": "HIGH"
  },
  {
    "category": "Scanner & Document Manager",
    "pattern": "Feature-Rich Showcase + Demo",
    "style": "Minimalism + Flat Design",
    "color_mood": "Clean white + camera viewfinder accent + file-type color coding",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Color shift hover + Fast 150ms transitions + No shadows",
    "anti_patterns": "Excessive decoration + Complex shadows + 3D effects",
    "severity": "HIGH"
  },
  {
    "category": "Calendar & Scheduling App",
    "pattern": "Feature-Rich Showcase + Demo",
    "style": "Flat Design + Micro-interactions",
    "color_mood": "Clean blue + event category accent colors + success green",
    "typography_mood": "Bold + Clean + Sans-serif",
    "effects": "Color shift hover + Fast 150ms transitions + No shadows",
    "anti_patterns": "Complex shadows + 3D effects",
    "severity": "HIGH"
  },
  {
    "category": "Password Manager",
    "pattern": "Trust & Authority + Feature-Rich",
    "style": "Minimalism + Accessible & Ethical",
    "color_mood": "Trust blue + security green + dark neutral",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Subtle hover 200ms + Smooth transitions + Clean",
    "anti_patterns": "Excessive decoration + Color-only indicators",
    "severity": "HIGH"
  },
  {
    "category": "Expense Splitter / Bill Split",
    "pattern": "Minimal & Direct + Demo",
    "style": "Flat Design + Vibrant & Block-based",
    "color_mood": "Success green + alert red + neutral grey + avatar accent colors",
    "typography_mood": "Bold + Clean + Sans-serif",
    "effects": "Color shift hover + Fast 150ms transitions + No shadows",
    "anti_patterns": "Complex shadows + 3D effects + Muted colors + Low energy",
    "severity": "HIGH"
  },
  {
    "category": "Voice Recorder & Memo",
    "pattern": "Interactive Product Demo + Minimal",
    "style": "Minimalism + AI-Native UI",
    "color_mood": "Clean white + recording red + waveform accent",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Subtle hover 200ms + Smooth transitions + Clean",
    "anti_patterns": "Excessive decoration",
    "severity": "HIGH"
  },
  {
    "category": "Bookmark & Read-Later",
    "pattern": "Minimal & Direct + Demo",
    "style": "Minimalism + Flat Design",
    "color_mood": "Paper warm white + ink neutral + minimal accent + tag colors",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Color shift hover + Fast 150ms transitions + No shadows",
    "anti_patterns": "Excessive decoration + Complex shadows + 3D effects",
    "severity": "HIGH"
  },
  {
    "category": "Translator App",
    "pattern": "Feature-Rich Showcase + Interactive Demo",
    "style": "Flat Design + AI-Native UI",
    "color_mood": "Global blue + neutral grey + language flag accent",
    "typography_mood": "Bold + Clean + Sans-serif",
    "effects": "Color shift hover + Fast 150ms transitions + No shadows",
    "anti_patterns": "Complex shadows + 3D effects",
    "severity": "HIGH"
  },
  {
    "category": "Calculator & Unit Converter",
    "pattern": "Minimal & Direct",
    "style": "Neumorphism + Minimalism",
    "color_mood": "Dark functional + orange operation keys + clear button hierarchy",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Dual shadows (light+dark) + Soft press 150ms",
    "anti_patterns": "Excessive decoration",
    "severity": "HIGH"
  },
  {
    "category": "Alarm & World Clock",
    "pattern": "Minimal & Direct",
    "style": "Dark Mode (OLED) + Minimalism",
    "color_mood": "Deep dark + ambient glow accent + timezone gradient",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Subtle glow + Neon accents + High contrast",
    "anti_patterns": "Excessive decoration + Pure white backgrounds",
    "severity": "HIGH"
  },
  {
    "category": "File Manager & Transfer",
    "pattern": "Feature-Rich Showcase + Demo",
    "style": "Flat Design + Minimalism",
    "color_mood": "Functional neutral + file type color coding (PDF orange, doc blue, image purple)",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Color shift hover + Fast 150ms transitions + No shadows",
    "anti_patterns": "Excessive decoration + Complex shadows + 3D effects",
    "severity": "HIGH"
  },
  {
    "category": "Email Client",
    "pattern": "Feature-Rich Showcase + Demo",
    "style": "Flat Design + Minimalism",
    "color_mood": "Clean white + brand primary + priority red + snooze amber",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Color shift hover + Fast 150ms transitions + No shadows",
    "anti_patterns": "Excessive decoration + Complex shadows + 3D effects",
    "severity": "HIGH"
  },
  {
    "category": "Casual Puzzle Game",
    "pattern": "Feature-Rich Showcase + Social Proof",
    "style": "Claymorphism + Vibrant & Block-based",
    "color_mood": "Cheerful pastels + progression gradient + reward gold + bright accent",
    "typography_mood": "Playful + Rounded + Friendly",
    "effects": "Multi-layer shadows + Spring bounce + Soft press 200ms",
    "anti_patterns": "Muted colors + Low energy",
    "severity": "HIGH"
  },
  {
    "category": "Trivia & Quiz Game",
    "pattern": "Feature-Rich Showcase + Social Proof",
    "style": "Vibrant & Block-based + Micro-interactions",
    "color_mood": "Energetic blue + correct green + incorrect red + leaderboard gold",
    "typography_mood": "Energetic + Bold + Large",
    "effects": "Haptic feedback + Small 50-100ms animations",
    "anti_patterns": "Muted colors + Low energy",
    "severity": "HIGH"
  },
  {
    "category": "Card & Board Game",
    "pattern": "Feature-Rich Showcase",
    "style": "3D & Hyperrealism + Flat Design",
    "color_mood": "Game-theme felt green + dark wood + card back patterns",
    "typography_mood": "Bold + Clean + Sans-serif",
    "effects": "Color shift hover + Fast 150ms transitions + No shadows",
    "anti_patterns": "Complex shadows + 3D effects",
    "severity": "HIGH"
  },
  {
    "category": "Idle & Clicker Game",
    "pattern": "Feature-Rich Showcase",
    "style": "Vibrant & Block-based + Motion-Driven",
    "color_mood": "Coin gold + upgrade blue + prestige purple + progress green",
    "typography_mood": "Energetic + Bold + Large",
    "effects": "Scroll animations + Parallax + Page transitions",
    "anti_patterns": "Muted colors + Low energy",
    "severity": "HIGH"
  },
  {
    "category": "Word & Crossword Game",
    "pattern": "Minimal & Direct + Demo",
    "style": "Minimalism + Flat Design",
    "color_mood": "Clean white + warm letter tiles + success green + shake red",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Color shift hover + Fast 150ms transitions + No shadows",
    "anti_patterns": "Excessive decoration + Complex shadows + 3D effects",
    "severity": "HIGH"
  },
  {
    "category": "Arcade & Retro Game",
    "pattern": "Feature-Rich Showcase + Hero-Centric",
    "style": "Pixel Art + Retro-Futurism",
    "color_mood": "Neon on black + pixel palette + score gold + danger red",
    "typography_mood": "Nostalgic + Monospace + Neon",
    "effects": "Subtle hover (200ms) + Smooth transitions",
    "anti_patterns": "Inconsistent styling + Poor contrast ratios",
    "severity": "HIGH"
  },
  {
    "category": "Photo Editor & Filters",
    "pattern": "Feature-Rich Showcase + Interactive Demo",
    "style": "Minimalism + Dark Mode (OLED)",
    "color_mood": "Dark editor background + vibrant filter preview strip + tool icon accent",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Subtle glow + Neon accents + High contrast",
    "anti_patterns": "Excessive decoration + Pure white backgrounds",
    "severity": "HIGH"
  },
  {
    "category": "Short Video Editor",
    "pattern": "Feature-Rich Showcase + Hero-Centric",
    "style": "Dark Mode (OLED) + Motion-Driven",
    "color_mood": "Dark background + timeline track accent colors + effect preview vivid",
    "typography_mood": "High contrast + Light on dark",
    "effects": "Subtle glow + Neon accents + High contrast",
    "anti_patterns": "Pure white backgrounds",
    "severity": "HIGH"
  },
  {
    "category": "Drawing & Sketching Canvas",
    "pattern": "Interactive Product Demo + Storytelling",
    "style": "Minimalism + Dark Mode (OLED)",
    "color_mood": "Neutral canvas + full-spectrum color picker + tool panel dark",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Subtle glow + Neon accents + High contrast",
    "anti_patterns": "Excessive decoration + Pure white backgrounds",
    "severity": "HIGH"
  },
  {
    "category": "Music Creation & Beat Maker",
    "pattern": "Interactive Product Demo + Storytelling",
    "style": "Dark Mode (OLED) + Motion-Driven",
    "color_mood": "Dark studio background + track colors rainbow + waveform accent + BPM pulse",
    "typography_mood": "High contrast + Light on dark",
    "effects": "Subtle glow + Neon accents + High contrast",
    "anti_patterns": "Pure white backgrounds",
    "severity": "HIGH"
  },
  {
    "category": "Meme & Sticker Maker",
    "pattern": "Feature-Rich Showcase + Social Proof",
    "style": "Vibrant & Block-based + Flat Design",
    "color_mood": "Bold primary + comedic yellow + viral red + high saturation accent",
    "typography_mood": "Bold + Clean + Sans-serif",
    "effects": "Color shift hover + Fast 150ms transitions + No shadows",
    "anti_patterns": "Complex shadows + 3D effects + Muted colors + Low energy",
    "severity": "HIGH"
  },
  {
    "category": "AI Photo & Avatar Generator",
    "pattern": "Feature-Rich Showcase + Social Proof",
    "style": "AI-Native UI + Aurora UI",
    "color_mood": "AI purple + aurora gradients + before/after neutral",
    "typography_mood": "Elegant + Gradient-friendly",
    "effects": "Flowing gradients 8-12s + Color morphing",
    "anti_patterns": "Inconsistent styling + Poor contrast ratios",
    "severity": "HIGH"
  },
  {
    "category": "Link-in-Bio Page Builder",
    "pattern": "Conversion-Optimized + Social Proof",
    "style": "Vibrant & Block-based + Bento Box Grid",
    "color_mood": "Brand-customizable + accent link color + clean white canvas",
    "typography_mood": "Energetic + Bold + Large",
    "effects": "Large section gaps 48px+ + Color shift hover + Scroll-snap",
    "anti_patterns": "Muted colors + Low energy",
    "severity": "HIGH"
  },
  {
    "category": "Wardrobe & Outfit Planner",
    "pattern": "Storytelling-Driven + Feature-Rich",
    "style": "Minimalism + Motion-Driven",
    "color_mood": "Clean fashion neutral + full clothes color palette + accent",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Subtle hover 200ms + Smooth transitions + Clean",
    "anti_patterns": "Excessive decoration",
    "severity": "HIGH"
  },
  {
    "category": "Plant Care Tracker",
    "pattern": "Storytelling-Driven + Social Proof",
    "style": "Organic Biophilic + Soft UI Evolution",
    "color_mood": "Nature greens + earth brown + sunny yellow reminder + water blue",
    "typography_mood": "Warm + Humanist + Natural",
    "effects": "Rounded 16-24px + Natural shadows + Flowing SVG",
    "anti_patterns": "Inconsistent styling + Poor contrast ratios",
    "severity": "HIGH"
  },
  {
    "category": "Book & Reading Tracker",
    "pattern": "Social Proof-Focused + Feature-Rich",
    "style": "Swiss Modernism 2.0 + Minimalism",
    "color_mood": "Warm paper white + ink brown + reading progress green + book cover colors",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Subtle hover 200ms + Smooth transitions + Clean",
    "anti_patterns": "Excessive decoration",
    "severity": "HIGH"
  },
  {
    "category": "Couple & Relationship App",
    "pattern": "Storytelling-Driven + Social Proof",
    "style": "Aurora UI + Soft UI Evolution",
    "color_mood": "Warm romantic pink/rose + soft gradient + memory photo tones",
    "typography_mood": "Elegant + Gradient-friendly",
    "effects": "Flowing gradients 8-12s + Color morphing",
    "anti_patterns": "Inconsistent styling + Poor contrast ratios",
    "severity": "HIGH"
  },
  {
    "category": "Family Calendar & Chores",
    "pattern": "Feature-Rich Showcase + Social Proof",
    "style": "Flat Design + Claymorphism",
    "color_mood": "Warm playful + member color coding + chore completion green",
    "typography_mood": "Playful + Rounded + Friendly",
    "effects": "Multi-layer shadows + Spring bounce + Soft press 200ms",
    "anti_patterns": "Complex shadows + 3D effects",
    "severity": "HIGH"
  },
  {
    "category": "Mood Tracker",
    "pattern": "Storytelling-Driven + Social Proof",
    "style": "Soft UI Evolution + Minimalism",
    "color_mood": "Emotion gradient (blue sad to yellow happy) + pastel per mood + insight accent",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Subtle hover 200ms + Smooth transitions + Clean",
    "anti_patterns": "Excessive decoration",
    "severity": "HIGH"
  },
  {
    "category": "Gift & Wishlist",
    "pattern": "Minimal & Direct + Conversion",
    "style": "Vibrant & Block-based + Soft UI Evolution",
    "color_mood": "Celebration warm pink/gold/red + category colors + surprise accent",
    "typography_mood": "Energetic + Bold + Large",
    "effects": "Large section gaps 48px+ + Color shift hover + Scroll-snap",
    "anti_patterns": "Muted colors + Low energy",
    "severity": "HIGH"
  },
  {
    "category": "Running & Cycling GPS",
    "pattern": "Feature-Rich Showcase + Social Proof",
    "style": "Dark Mode (OLED) + Vibrant & Block-based",
    "color_mood": "Energetic orange + map accent + pace zones (green/yellow/red)",
    "typography_mood": "High contrast + Light on dark",
    "effects": "Subtle glow + Neon accents + High contrast",
    "anti_patterns": "Pure white backgrounds + Muted colors + Low energy",
    "severity": "HIGH"
  },
  {
    "category": "Yoga & Stretching Guide",
    "pattern": "Storytelling-Driven + Social Proof",
    "style": "Organic Biophilic + Soft UI Evolution",
    "color_mood": "Earth calming sage/terracotta/cream + breathing gradient + warm accent",
    "typography_mood": "Warm + Humanist + Natural",
    "effects": "Rounded 16-24px + Natural shadows + Flowing SVG",
    "anti_patterns": "Inconsistent styling + Poor contrast ratios",
    "severity": "HIGH"
  },
  {
    "category": "Sleep Tracker",
    "pattern": "Feature-Rich Showcase + Social Proof",
    "style": "Dark Mode (OLED) + Neumorphism",
    "color_mood": "Deep midnight blue + stars/moon accent + sleep quality gradient (poor red to great green)",
    "typography_mood": "High contrast + Light on dark",
    "effects": "Dual shadows (light+dark) + Soft press 150ms",
    "anti_patterns": "Pure white backgrounds",
    "severity": "HIGH"
  },
  {
    "category": "Calorie & Nutrition Counter",
    "pattern": "Feature-Rich Showcase + Social Proof",
    "style": "Flat Design + Vibrant & Block-based",
    "color_mood": "Healthy green + macro colors (protein blue, carb orange, fat yellow) + progress circle",
    "typography_mood": "Bold + Clean + Sans-serif",
    "effects": "Color shift hover + Fast 150ms transitions + No shadows",
    "anti_patterns": "Complex shadows + 3D effects + Muted colors + Low energy",
    "severity": "HIGH"
  },
  {
    "category": "Period & Cycle Tracker",
    "pattern": "Social Proof-Focused + Trust",
    "style": "Soft UI Evolution + Aurora UI",
    "color_mood": "Rose/blush + lavender + fertility green + soft calendar tones",
    "typography_mood": "Elegant + Gradient-friendly",
    "effects": "Flowing gradients 8-12s + Color morphing",
    "anti_patterns": "Inconsistent styling + Poor contrast ratios",
    "severity": "HIGH"
  },
  {
    "category": "Medication & Pill Reminder",
    "pattern": "Trust & Authority + Feature-Rich",
    "style": "Accessible & Ethical + Flat Design",
    "color_mood": "Medical trust blue + missed alert red + taken green + clean white",
    "typography_mood": "Bold + Clean + Sans-serif",
    "effects": "Color shift hover + Fast 150ms transitions + No shadows",
    "anti_patterns": "Complex shadows + 3D effects + Color-only indicators",
    "severity": "HIGH"
  },
  {
    "category": "Water & Hydration Reminder",
    "pattern": "Minimal & Direct + Demo",
    "style": "Claymorphism + Vibrant & Block-based",
    "color_mood": "Refreshing blue + water wave animation + goal progress accent",
    "typography_mood": "Playful + Rounded + Friendly",
    "effects": "Multi-layer shadows + Spring bounce + Soft press 200ms",
    "anti_patterns": "Muted colors + Low energy",
    "severity": "HIGH"
  },
  {
    "category": "Fasting & Intermittent Timer",
    "pattern": "Feature-Rich Showcase + Social Proof",
    "style": "Minimalism + Dark Mode (OLED)",
    "color_mood": "Fasting deep blue/purple + eating window green + timeline neutral",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Subtle glow + Neon accents + High contrast",
    "anti_patterns": "Excessive decoration + Pure white backgrounds",
    "severity": "HIGH"
  },
  {
    "category": "Anonymous Community / Confession",
    "pattern": "Social Proof-Focused + Feature-Rich",
    "style": "Dark Mode (OLED) + Minimalism",
    "color_mood": "Dark protective + subtle gradient + upvote green + empathy warm accent",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Subtle glow + Neon accents + High contrast",
    "anti_patterns": "Excessive decoration + Pure white backgrounds",
    "severity": "HIGH"
  },
  {
    "category": "Local Events & Discovery",
    "pattern": "Hero-Centric Design + Feature-Rich",
    "style": "Vibrant & Block-based + Motion-Driven",
    "color_mood": "City vibrant + event category colors + map accent + date highlight",
    "typography_mood": "Energetic + Bold + Large",
    "effects": "Scroll animations + Parallax + Page transitions",
    "anti_patterns": "Muted colors + Low energy",
    "severity": "HIGH"
  },
  {
    "category": "Study Together / Virtual Coworking",
    "pattern": "Social Proof-Focused + Feature-Rich",
    "style": "Minimalism + Soft UI Evolution",
    "color_mood": "Calm focus blue + session progress indicator + ambient warm neutrals",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Subtle hover 200ms + Smooth transitions + Clean",
    "anti_patterns": "Excessive decoration",
    "severity": "HIGH"
  },
  {
    "category": "Coding Challenge & Practice",
    "pattern": "Feature-Rich Showcase + Social Proof",
    "style": "Dark Mode (OLED) + Cyberpunk UI",
    "color_mood": "Code editor dark + success green + difficulty gradient (easy green / medium amber / hard red)",
    "typography_mood": "High contrast + Light on dark",
    "effects": "Subtle glow + Neon accents + High contrast",
    "anti_patterns": "Pure white backgrounds",
    "severity": "HIGH"
  },
  {
    "category": "Kids Learning (ABC & Math)",
    "pattern": "Social Proof-Focused + Trust",
    "style": "Claymorphism + Vibrant & Block-based",
    "color_mood": "Bright primary + child-safe pastels + reward gold + interactive accent",
    "typography_mood": "Playful + Rounded + Friendly",
    "effects": "Multi-layer shadows + Spring bounce + Soft press 200ms",
    "anti_patterns": "Muted colors + Low energy",
    "severity": "HIGH"
  },
  {
    "category": "Music Instrument Learning",
    "pattern": "Interactive Product Demo + Social Proof",
    "style": "Vibrant & Block-based + Motion-Driven",
    "color_mood": "Musical warm deep red/brown + note color system + skill progress bar",
    "typography_mood": "Energetic + Bold + Large",
    "effects": "Scroll animations + Parallax + Page transitions",
    "anti_patterns": "Muted colors + Low energy",
    "severity": "HIGH"
  },
  {
    "category": "Parking Finder",
    "pattern": "Conversion-Optimized + Feature-Rich",
    "style": "Minimalism + Glassmorphism",
    "color_mood": "Trust blue + available green + occupied red + map neutral",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Backdrop blur (10-20px) + Translucent overlays",
    "anti_patterns": "Excessive decoration",
    "severity": "HIGH"
  },
  {
    "category": "Public Transit Guide",
    "pattern": "Feature-Rich Showcase + Interactive Demo",
    "style": "Flat Design + Accessible & Ethical",
    "color_mood": "Transit brand line colors + real-time indicator green/red + map neutral",
    "typography_mood": "Bold + Clean + Sans-serif",
    "effects": "Color shift hover + Fast 150ms transitions + No shadows",
    "anti_patterns": "Complex shadows + 3D effects + Color-only indicators",
    "severity": "HIGH"
  },
  {
    "category": "Road Trip Planner",
    "pattern": "Storytelling-Driven + Hero-Centric",
    "style": "Aurora UI + Organic Biophilic",
    "color_mood": "Adventure warm sunset orange + map teal + stop markers + road neutral",
    "typography_mood": "Elegant + Gradient-friendly",
    "effects": "Flowing gradients 8-12s + Color morphing",
    "anti_patterns": "Inconsistent styling + Poor contrast ratios",
    "severity": "HIGH"
  },
  {
    "category": "VPN & Privacy Tool",
    "pattern": "Trust & Authority + Conversion-Optimized",
    "style": "Minimalism + Dark Mode (OLED)",
    "color_mood": "Dark shield blue + connected green + disconnected red + trust accent",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Subtle glow + Neon accents + High contrast",
    "anti_patterns": "Excessive decoration + Pure white backgrounds",
    "severity": "HIGH"
  },
  {
    "category": "Emergency SOS & Safety",
    "pattern": "Trust & Authority + Social Proof",
    "style": "Accessible & Ethical + Flat Design",
    "color_mood": "Alert red + safety blue + location green + high contrast critical",
    "typography_mood": "Bold + Clean + Sans-serif",
    "effects": "Color shift hover + Fast 150ms transitions + No shadows",
    "anti_patterns": "Complex shadows + 3D effects + Color-only indicators",
    "severity": "HIGH"
  },
  {
    "category": "Wallpaper & Theme App",
    "pattern": "Feature-Rich Showcase + Social Proof",
    "style": "Vibrant & Block-based + Aurora UI",
    "color_mood": "Content-driven + trending aesthetic palettes + download accent",
    "typography_mood": "Energetic + Bold + Large",
    "effects": "Large section gaps 48px+ + Color shift hover + Scroll-snap",
    "anti_patterns": "Muted colors + Low energy",
    "severity": "HIGH"
  },
  {
    "category": "White Noise & Ambient Sound",
    "pattern": "Minimal & Direct + Social Proof",
    "style": "Minimalism + Dark Mode (OLED)",
    "color_mood": "Calming dark + ambient texture visual + subtle sound wave + sleep blue",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Subtle glow + Neon accents + High contrast",
    "anti_patterns": "Excessive decoration + Pure white backgrounds",
    "severity": "HIGH"
  },
  {
    "category": "Home Decoration & Interior Design",
    "pattern": "Storytelling-Driven + Feature-Rich",
    "style": "Minimalism + 3D Product Preview",
    "color_mood": "Neutral interior palette + material texture accent + AR blue",
    "typography_mood": "Professional + Clean hierarchy",
    "effects": "Subtle hover 200ms + Smooth transitions + Clean",
    "anti_patterns": "Excessive decoration",
    "severity": "HIGH"
  }
];

export const COLOR_PALETTES: ColorPalette[] = [
  {
    "product": "SaaS (General)",
    "primary": "#2563EB",
    "secondary": "#3B82F6",
    "accent": "#EA580C",
    "background": "#F8FAFC",
    "foreground": "#1E293B",
    "card": "#FFFFFF",
    "muted": "#E9EFF8",
    "border": "#E2E8F0",
    "muted_fg": "#64748B",
    "notes": "Trust blue + orange CTA contrast [Accent adjusted from #F97316 for WCAG 3:1]"
  },
  {
    "product": "Micro SaaS",
    "primary": "#6366F1",
    "secondary": "#818CF8",
    "accent": "#059669",
    "background": "#F5F3FF",
    "foreground": "#1E1B4B",
    "card": "#FFFFFF",
    "muted": "#EBEFF9",
    "border": "#E0E7FF",
    "muted_fg": "#64748B",
    "notes": "Indigo primary + emerald CTA [Accent adjusted from #10B981 for WCAG 3:1]"
  },
  {
    "product": "E-commerce",
    "primary": "#059669",
    "secondary": "#10B981",
    "accent": "#EA580C",
    "background": "#ECFDF5",
    "foreground": "#064E3B",
    "card": "#FFFFFF",
    "muted": "#E8F1F3",
    "border": "#A7F3D0",
    "muted_fg": "#64748B",
    "notes": "Success green + urgency orange [Accent adjusted from #F97316 for WCAG 3:1]"
  },
  {
    "product": "E-commerce Luxury",
    "primary": "#1C1917",
    "secondary": "#44403C",
    "accent": "#A16207",
    "background": "#FAFAF9",
    "foreground": "#0C0A09",
    "card": "#FFFFFF",
    "muted": "#E8ECF0",
    "border": "#D6D3D1",
    "muted_fg": "#64748B",
    "notes": "Premium dark + gold accent [Accent adjusted from #CA8A04 for WCAG 3:1]"
  },
  {
    "product": "B2B Service",
    "primary": "#0F172A",
    "secondary": "#334155",
    "accent": "#0369A1",
    "background": "#F8FAFC",
    "foreground": "#020617",
    "card": "#FFFFFF",
    "muted": "#E8ECF1",
    "border": "#E2E8F0",
    "muted_fg": "#64748B",
    "notes": "Professional navy + blue CTA"
  },
  {
    "product": "Financial Dashboard",
    "primary": "#0F172A",
    "secondary": "#1E293B",
    "accent": "#22C55E",
    "background": "#020617",
    "foreground": "#F8FAFC",
    "card": "#0E1223",
    "muted": "#1A1E2F",
    "border": "#334155",
    "muted_fg": "#94A3B8",
    "notes": "Dark bg + green positive indicators"
  },
  {
    "product": "Analytics Dashboard",
    "primary": "#1E40AF",
    "secondary": "#3B82F6",
    "accent": "#D97706",
    "background": "#F8FAFC",
    "foreground": "#1E3A8A",
    "card": "#FFFFFF",
    "muted": "#E9EEF6",
    "border": "#DBEAFE",
    "muted_fg": "#64748B",
    "notes": "Blue data + amber highlights [Accent adjusted from #F59E0B for WCAG 3:1]"
  },
  {
    "product": "Healthcare App",
    "primary": "#0891B2",
    "secondary": "#22D3EE",
    "accent": "#059669",
    "background": "#ECFEFF",
    "foreground": "#164E63",
    "card": "#FFFFFF",
    "muted": "#E8F1F6",
    "border": "#A5F3FC",
    "muted_fg": "#64748B",
    "notes": "Calm cyan + health green"
  },
  {
    "product": "Educational App",
    "primary": "#4F46E5",
    "secondary": "#818CF8",
    "accent": "#EA580C",
    "background": "#EEF2FF",
    "foreground": "#1E1B4B",
    "card": "#FFFFFF",
    "muted": "#EBEEF8",
    "border": "#C7D2FE",
    "muted_fg": "#64748B",
    "notes": "Playful indigo + energetic orange [Accent adjusted from #F97316 for WCAG 3:1]"
  },
  {
    "product": "Creative Agency",
    "primary": "#EC4899",
    "secondary": "#F472B6",
    "accent": "#0891B2",
    "background": "#FDF2F8",
    "foreground": "#831843",
    "card": "#FFFFFF",
    "muted": "#F1EEF5",
    "border": "#FBCFE8",
    "muted_fg": "#64748B",
    "notes": "Bold pink + cyan accent [Accent adjusted from #06B6D4 for WCAG 3:1]"
  },
  {
    "product": "Portfolio/Personal",
    "primary": "#18181B",
    "secondary": "#3F3F46",
    "accent": "#2563EB",
    "background": "#FAFAFA",
    "foreground": "#09090B",
    "card": "#FFFFFF",
    "muted": "#E8ECF0",
    "border": "#E4E4E7",
    "muted_fg": "#64748B",
    "notes": "Monochrome + blue accent"
  },
  {
    "product": "Gaming",
    "primary": "#7C3AED",
    "secondary": "#A78BFA",
    "accent": "#F43F5E",
    "background": "#0F0F23",
    "foreground": "#E2E8F0",
    "card": "#1E1C35",
    "muted": "#27273B",
    "border": "#4C1D95",
    "muted_fg": "#94A3B8",
    "notes": "Neon purple + rose action"
  },
  {
    "product": "Government/Public Service",
    "primary": "#0F172A",
    "secondary": "#334155",
    "accent": "#0369A1",
    "background": "#F8FAFC",
    "foreground": "#020617",
    "card": "#FFFFFF",
    "muted": "#E8ECF1",
    "border": "#E2E8F0",
    "muted_fg": "#64748B",
    "notes": "High contrast navy + blue"
  },
  {
    "product": "Fintech/Crypto",
    "primary": "#F59E0B",
    "secondary": "#FBBF24",
    "accent": "#8B5CF6",
    "background": "#0F172A",
    "foreground": "#F8FAFC",
    "card": "#222735",
    "muted": "#272F42",
    "border": "#334155",
    "muted_fg": "#94A3B8",
    "notes": "Gold trust + purple tech"
  },
  {
    "product": "Social Media App",
    "primary": "#E11D48",
    "secondary": "#FB7185",
    "accent": "#2563EB",
    "background": "#FFF1F2",
    "foreground": "#881337",
    "card": "#FFFFFF",
    "muted": "#F0ECF2",
    "border": "#FECDD3",
    "muted_fg": "#64748B",
    "notes": "Vibrant rose + engagement blue"
  },
  {
    "product": "Productivity Tool",
    "primary": "#0D9488",
    "secondary": "#14B8A6",
    "accent": "#EA580C",
    "background": "#F0FDFA",
    "foreground": "#134E4A",
    "card": "#FFFFFF",
    "muted": "#E8F1F4",
    "border": "#99F6E4",
    "muted_fg": "#64748B",
    "notes": "Teal focus + action orange [Accent adjusted from #F97316 for WCAG 3:1]"
  },
  {
    "product": "Design System/Component Library",
    "primary": "#4F46E5",
    "secondary": "#6366F1",
    "accent": "#EA580C",
    "background": "#EEF2FF",
    "foreground": "#312E81",
    "card": "#FFFFFF",
    "muted": "#EBEEF8",
    "border": "#C7D2FE",
    "muted_fg": "#64748B",
    "notes": "Indigo brand + doc hierarchy [Accent adjusted from #F97316 for WCAG 3:1]"
  },
  {
    "product": "AI/Chatbot Platform",
    "primary": "#7C3AED",
    "secondary": "#A78BFA",
    "accent": "#0891B2",
    "background": "#FAF5FF",
    "foreground": "#1E1B4B",
    "card": "#FFFFFF",
    "muted": "#ECEEF9",
    "border": "#DDD6FE",
    "muted_fg": "#64748B",
    "notes": "AI purple + cyan interactions [Accent adjusted from #06B6D4 for WCAG 3:1]"
  },
  {
    "product": "NFT/Web3 Platform",
    "primary": "#8B5CF6",
    "secondary": "#A78BFA",
    "accent": "#FBBF24",
    "background": "#0F0F23",
    "foreground": "#F8FAFC",
    "card": "#1E1D35",
    "muted": "#27273B",
    "border": "#4C1D95",
    "muted_fg": "#94A3B8",
    "notes": "Purple tech + gold value"
  },
  {
    "product": "Creator Economy Platform",
    "primary": "#EC4899",
    "secondary": "#F472B6",
    "accent": "#EA580C",
    "background": "#FDF2F8",
    "foreground": "#831843",
    "card": "#FFFFFF",
    "muted": "#F1EEF5",
    "border": "#FBCFE8",
    "muted_fg": "#64748B",
    "notes": "Creator pink + engagement orange [Accent adjusted from #F97316 for WCAG 3:1]"
  },
  {
    "product": "Remote Work/Collaboration Tool",
    "primary": "#6366F1",
    "secondary": "#818CF8",
    "accent": "#059669",
    "background": "#F5F3FF",
    "foreground": "#312E81",
    "card": "#FFFFFF",
    "muted": "#EBEFF9",
    "border": "#E0E7FF",
    "muted_fg": "#64748B",
    "notes": "Calm indigo + success green [Accent adjusted from #10B981 for WCAG 3:1]"
  },
  {
    "product": "Mental Health App",
    "primary": "#8B5CF6",
    "secondary": "#C4B5FD",
    "accent": "#059669",
    "background": "#FAF5FF",
    "foreground": "#4C1D95",
    "card": "#FFFFFF",
    "muted": "#EDEFF9",
    "border": "#EDE9FE",
    "muted_fg": "#64748B",
    "notes": "Calming lavender + wellness green [Accent adjusted from #10B981 for WCAG 3:1]"
  },
  {
    "product": "Pet Tech App",
    "primary": "#F97316",
    "secondary": "#FB923C",
    "accent": "#2563EB",
    "background": "#FFF7ED",
    "foreground": "#9A3412",
    "card": "#FFFFFF",
    "muted": "#F1F0F0",
    "border": "#FED7AA",
    "muted_fg": "#64748B",
    "notes": "Playful orange + trust blue"
  },
  {
    "product": "Smart Home/IoT Dashboard",
    "primary": "#1E293B",
    "secondary": "#334155",
    "accent": "#22C55E",
    "background": "#0F172A",
    "foreground": "#F8FAFC",
    "card": "#1B2336",
    "muted": "#272F42",
    "border": "#475569",
    "muted_fg": "#94A3B8",
    "notes": "Dark tech + status green"
  },
  {
    "product": "EV/Charging Ecosystem",
    "primary": "#0891B2",
    "secondary": "#22D3EE",
    "accent": "#16A34A",
    "background": "#ECFEFF",
    "foreground": "#164E63",
    "card": "#FFFFFF",
    "muted": "#E8F1F6",
    "border": "#A5F3FC",
    "muted_fg": "#64748B",
    "notes": "Electric cyan + eco green [Accent adjusted from #22C55E for WCAG 3:1]"
  },
  {
    "product": "Subscription Box Service",
    "primary": "#D946EF",
    "secondary": "#E879F9",
    "accent": "#EA580C",
    "background": "#FDF4FF",
    "foreground": "#86198F",
    "card": "#FFFFFF",
    "muted": "#F0EEF9",
    "border": "#F5D0FE",
    "muted_fg": "#64748B",
    "notes": "Excitement purple + urgency orange [Accent adjusted from #F97316 for WCAG 3:1]"
  },
  {
    "product": "Podcast Platform",
    "primary": "#1E1B4B",
    "secondary": "#312E81",
    "accent": "#F97316",
    "background": "#0F0F23",
    "foreground": "#F8FAFC",
    "card": "#1B1B30",
    "muted": "#27273B",
    "border": "#4338CA",
    "muted_fg": "#94A3B8",
    "notes": "Dark audio + warm accent"
  },
  {
    "product": "Dating App",
    "primary": "#E11D48",
    "secondary": "#FB7185",
    "accent": "#EA580C",
    "background": "#FFF1F2",
    "foreground": "#881337",
    "card": "#FFFFFF",
    "muted": "#F0ECF2",
    "border": "#FECDD3",
    "muted_fg": "#64748B",
    "notes": "Romantic rose + warm orange [Accent adjusted from #F97316 for WCAG 3:1]"
  },
  {
    "product": "Micro-Credentials/Badges Platform",
    "primary": "#0369A1",
    "secondary": "#0EA5E9",
    "accent": "#A16207",
    "background": "#F0F9FF",
    "foreground": "#0C4A6E",
    "card": "#FFFFFF",
    "muted": "#E7EFF5",
    "border": "#BAE6FD",
    "muted_fg": "#64748B",
    "notes": "Trust blue + achievement gold [Accent adjusted from #CA8A04 for WCAG 3:1]"
  },
  {
    "product": "Knowledge Base/Documentation",
    "primary": "#475569",
    "secondary": "#64748B",
    "accent": "#2563EB",
    "background": "#F8FAFC",
    "foreground": "#1E293B",
    "card": "#FFFFFF",
    "muted": "#EAEFF3",
    "border": "#E2E8F0",
    "muted_fg": "#64748B",
    "notes": "Neutral grey + link blue"
  },
  {
    "product": "Hyperlocal Services",
    "primary": "#059669",
    "secondary": "#10B981",
    "accent": "#EA580C",
    "background": "#ECFDF5",
    "foreground": "#064E3B",
    "card": "#FFFFFF",
    "muted": "#E8F1F3",
    "border": "#A7F3D0",
    "muted_fg": "#64748B",
    "notes": "Location green + action orange [Accent adjusted from #F97316 for WCAG 3:1]"
  },
  {
    "product": "Beauty/Spa/Wellness Service",
    "primary": "#EC4899",
    "secondary": "#F9A8D4",
    "accent": "#8B5CF6",
    "background": "#FDF2F8",
    "foreground": "#831843",
    "card": "#FFFFFF",
    "muted": "#F1EEF5",
    "border": "#FBCFE8",
    "muted_fg": "#64748B",
    "notes": "Soft pink + lavender luxury"
  },
  {
    "product": "Luxury/Premium Brand",
    "primary": "#1C1917",
    "secondary": "#44403C",
    "accent": "#A16207",
    "background": "#FAFAF9",
    "foreground": "#0C0A09",
    "card": "#FFFFFF",
    "muted": "#E8ECF0",
    "border": "#D6D3D1",
    "muted_fg": "#64748B",
    "notes": "Premium black + gold accent [Accent adjusted from #CA8A04 for WCAG 3:1]"
  },
  {
    "product": "Restaurant/Food Service",
    "primary": "#DC2626",
    "secondary": "#F87171",
    "accent": "#A16207",
    "background": "#FEF2F2",
    "foreground": "#450A0A",
    "card": "#FFFFFF",
    "muted": "#F0EDF1",
    "border": "#FECACA",
    "muted_fg": "#64748B",
    "notes": "Appetizing red + warm gold [Accent adjusted from #CA8A04 for WCAG 3:1]"
  },
  {
    "product": "Fitness/Gym App",
    "primary": "#F97316",
    "secondary": "#FB923C",
    "accent": "#22C55E",
    "background": "#1F2937",
    "foreground": "#F8FAFC",
    "card": "#313742",
    "muted": "#37414F",
    "border": "#374151",
    "muted_fg": "#94A3B8",
    "notes": "Energy orange + success green"
  },
  {
    "product": "Real Estate/Property",
    "primary": "#0F766E",
    "secondary": "#14B8A6",
    "accent": "#0369A1",
    "background": "#F0FDFA",
    "foreground": "#134E4A",
    "card": "#FFFFFF",
    "muted": "#E8F0F3",
    "border": "#99F6E4",
    "muted_fg": "#64748B",
    "notes": "Trust teal + professional blue"
  },
  {
    "product": "Travel/Tourism Agency",
    "primary": "#0EA5E9",
    "secondary": "#38BDF8",
    "accent": "#EA580C",
    "background": "#F0F9FF",
    "foreground": "#0C4A6E",
    "card": "#FFFFFF",
    "muted": "#E8F2F8",
    "border": "#BAE6FD",
    "muted_fg": "#64748B",
    "notes": "Sky blue + adventure orange [Accent adjusted from #F97316 for WCAG 3:1]"
  },
  {
    "product": "Hotel/Hospitality",
    "primary": "#1E3A8A",
    "secondary": "#3B82F6",
    "accent": "#A16207",
    "background": "#F8FAFC",
    "foreground": "#1E40AF",
    "card": "#FFFFFF",
    "muted": "#E9EEF5",
    "border": "#BFDBFE",
    "muted_fg": "#64748B",
    "notes": "Luxury navy + gold service [Accent adjusted from #CA8A04 for WCAG 3:1]"
  },
  {
    "product": "Wedding/Event Planning",
    "primary": "#DB2777",
    "secondary": "#F472B6",
    "accent": "#A16207",
    "background": "#FDF2F8",
    "foreground": "#831843",
    "card": "#FFFFFF",
    "muted": "#F0EDF4",
    "border": "#FBCFE8",
    "muted_fg": "#64748B",
    "notes": "Romantic pink + elegant gold [Accent adjusted from #CA8A04 for WCAG 3:1]"
  },
  {
    "product": "Legal Services",
    "primary": "#1E3A8A",
    "secondary": "#1E40AF",
    "accent": "#B45309",
    "background": "#F8FAFC",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#E9EEF5",
    "border": "#CBD5E1",
    "muted_fg": "#64748B",
    "notes": "Authority navy + trust gold"
  },
  {
    "product": "Insurance Platform",
    "primary": "#0369A1",
    "secondary": "#0EA5E9",
    "accent": "#16A34A",
    "background": "#F0F9FF",
    "foreground": "#0C4A6E",
    "card": "#FFFFFF",
    "muted": "#E7EFF5",
    "border": "#BAE6FD",
    "muted_fg": "#64748B",
    "notes": "Security blue + protected green [Accent adjusted from #22C55E for WCAG 3:1]"
  },
  {
    "product": "Banking/Traditional Finance",
    "primary": "#0F172A",
    "secondary": "#1E3A8A",
    "accent": "#A16207",
    "background": "#F8FAFC",
    "foreground": "#020617",
    "card": "#FFFFFF",
    "muted": "#E8ECF1",
    "border": "#E2E8F0",
    "muted_fg": "#64748B",
    "notes": "Trust navy + premium gold [Accent adjusted from #CA8A04 for WCAG 3:1]"
  },
  {
    "product": "Online Course/E-learning",
    "primary": "#0D9488",
    "secondary": "#2DD4BF",
    "accent": "#EA580C",
    "background": "#F0FDFA",
    "foreground": "#134E4A",
    "card": "#FFFFFF",
    "muted": "#E8F1F4",
    "border": "#5EEAD4",
    "muted_fg": "#64748B",
    "notes": "Progress teal + achievement orange [Accent adjusted from #F97316 for WCAG 3:1]"
  },
  {
    "product": "Non-profit/Charity",
    "primary": "#0891B2",
    "secondary": "#22D3EE",
    "accent": "#EA580C",
    "background": "#ECFEFF",
    "foreground": "#164E63",
    "card": "#FFFFFF",
    "muted": "#E8F1F6",
    "border": "#A5F3FC",
    "muted_fg": "#64748B",
    "notes": "Compassion blue + action orange [Accent adjusted from #F97316 for WCAG 3:1]"
  },
  {
    "product": "Music Streaming",
    "primary": "#1E1B4B",
    "secondary": "#4338CA",
    "accent": "#22C55E",
    "background": "#0F0F23",
    "foreground": "#F8FAFC",
    "card": "#1B1B30",
    "muted": "#27273B",
    "border": "#312E81",
    "muted_fg": "#94A3B8",
    "notes": "Dark audio + play green"
  },
  {
    "product": "Video Streaming/OTT",
    "primary": "#0F0F23",
    "secondary": "#1E1B4B",
    "accent": "#E11D48",
    "background": "#000000",
    "foreground": "#F8FAFC",
    "card": "#0C0C0D",
    "muted": "#181818",
    "border": "#312E81",
    "muted_fg": "#94A3B8",
    "notes": "Cinema dark + play red"
  },
  {
    "product": "Job Board/Recruitment",
    "primary": "#0369A1",
    "secondary": "#0EA5E9",
    "accent": "#16A34A",
    "background": "#F0F9FF",
    "foreground": "#0C4A6E",
    "card": "#FFFFFF",
    "muted": "#E7EFF5",
    "border": "#BAE6FD",
    "muted_fg": "#64748B",
    "notes": "Professional blue + success green [Accent adjusted from #22C55E for WCAG 3:1]"
  },
  {
    "product": "Marketplace (P2P)",
    "primary": "#7C3AED",
    "secondary": "#A78BFA",
    "accent": "#16A34A",
    "background": "#FAF5FF",
    "foreground": "#4C1D95",
    "card": "#FFFFFF",
    "muted": "#ECEEF9",
    "border": "#DDD6FE",
    "muted_fg": "#64748B",
    "notes": "Trust purple + transaction green [Accent adjusted from #22C55E for WCAG 3:1]"
  },
  {
    "product": "Logistics/Delivery",
    "primary": "#2563EB",
    "secondary": "#3B82F6",
    "accent": "#EA580C",
    "background": "#EFF6FF",
    "foreground": "#1E40AF",
    "card": "#FFFFFF",
    "muted": "#E9EFF8",
    "border": "#BFDBFE",
    "muted_fg": "#64748B",
    "notes": "Tracking blue + delivery orange [Accent adjusted from #F97316 for WCAG 3:1]"
  },
  {
    "product": "Agriculture/Farm Tech",
    "primary": "#15803D",
    "secondary": "#22C55E",
    "accent": "#A16207",
    "background": "#F0FDF4",
    "foreground": "#14532D",
    "card": "#FFFFFF",
    "muted": "#E8F0F1",
    "border": "#BBF7D0",
    "muted_fg": "#64748B",
    "notes": "Earth green + harvest gold [Accent adjusted from #CA8A04 for WCAG 3:1]"
  },
  {
    "product": "Construction/Architecture",
    "primary": "#64748B",
    "secondary": "#94A3B8",
    "accent": "#EA580C",
    "background": "#F8FAFC",
    "foreground": "#334155",
    "card": "#FFFFFF",
    "muted": "#EBF0F5",
    "border": "#E2E8F0",
    "muted_fg": "#64748B",
    "notes": "Industrial grey + safety orange [Accent adjusted from #F97316 for WCAG 3:1]"
  },
  {
    "product": "Automotive/Car Dealership",
    "primary": "#1E293B",
    "secondary": "#334155",
    "accent": "#DC2626",
    "background": "#F8FAFC",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#E9EDF1",
    "border": "#E2E8F0",
    "muted_fg": "#64748B",
    "notes": "Premium dark + action red"
  },
  {
    "product": "Photography Studio",
    "primary": "#18181B",
    "secondary": "#27272A",
    "accent": "#F8FAFC",
    "background": "#000000",
    "foreground": "#FAFAFA",
    "card": "#0C0C0C",
    "muted": "#181818",
    "border": "#3F3F46",
    "muted_fg": "#94A3B8",
    "notes": "Pure black + white contrast"
  },
  {
    "product": "Coworking Space",
    "primary": "#F59E0B",
    "secondary": "#FBBF24",
    "accent": "#2563EB",
    "background": "#FFFBEB",
    "foreground": "#78350F",
    "card": "#FFFFFF",
    "muted": "#F1F2EF",
    "border": "#FDE68A",
    "muted_fg": "#64748B",
    "notes": "Energetic amber + booking blue"
  },
  {
    "product": "Home Services (Plumber/Electrician)",
    "primary": "#1E40AF",
    "secondary": "#3B82F6",
    "accent": "#EA580C",
    "background": "#EFF6FF",
    "foreground": "#1E3A8A",
    "card": "#FFFFFF",
    "muted": "#E9EEF6",
    "border": "#BFDBFE",
    "muted_fg": "#64748B",
    "notes": "Professional blue + urgent orange [Accent adjusted from #F97316 for WCAG 3:1]"
  },
  {
    "product": "Childcare/Daycare",
    "primary": "#F472B6",
    "secondary": "#FBCFE8",
    "accent": "#16A34A",
    "background": "#FDF2F8",
    "foreground": "#9D174D",
    "card": "#FFFFFF",
    "muted": "#F1F0F6",
    "border": "#FCE7F3",
    "muted_fg": "#64748B",
    "notes": "Soft pink + safe green [Accent adjusted from #22C55E for WCAG 3:1]"
  },
  {
    "product": "Senior Care/Elderly",
    "primary": "#0369A1",
    "secondary": "#38BDF8",
    "accent": "#16A34A",
    "background": "#F0F9FF",
    "foreground": "#0C4A6E",
    "card": "#FFFFFF",
    "muted": "#E7EFF5",
    "border": "#E0F2FE",
    "muted_fg": "#64748B",
    "notes": "Calm blue + reassuring green [Accent adjusted from #22C55E for WCAG 3:1]"
  },
  {
    "product": "Medical Clinic",
    "primary": "#0891B2",
    "secondary": "#22D3EE",
    "accent": "#16A34A",
    "background": "#F0FDFA",
    "foreground": "#134E4A",
    "card": "#FFFFFF",
    "muted": "#E8F1F6",
    "border": "#CCFBF1",
    "muted_fg": "#64748B",
    "notes": "Medical teal + health green [Accent adjusted from #22C55E for WCAG 3:1]"
  },
  {
    "product": "Pharmacy/Drug Store",
    "primary": "#15803D",
    "secondary": "#22C55E",
    "accent": "#0369A1",
    "background": "#F0FDF4",
    "foreground": "#14532D",
    "card": "#FFFFFF",
    "muted": "#E8F0F1",
    "border": "#BBF7D0",
    "muted_fg": "#64748B",
    "notes": "Pharmacy green + trust blue"
  },
  {
    "product": "Dental Practice",
    "primary": "#0EA5E9",
    "secondary": "#38BDF8",
    "accent": "#0EA5E9",
    "background": "#F0F9FF",
    "foreground": "#0C4A6E",
    "card": "#FFFFFF",
    "muted": "#E8F2F8",
    "border": "#BAE6FD",
    "muted_fg": "#64748B",
    "notes": "Fresh blue + smile yellow [Accent adjusted from #FBBF24 for WCAG 3:1]"
  },
  {
    "product": "Veterinary Clinic",
    "primary": "#0D9488",
    "secondary": "#14B8A6",
    "accent": "#EA580C",
    "background": "#F0FDFA",
    "foreground": "#134E4A",
    "card": "#FFFFFF",
    "muted": "#E8F1F4",
    "border": "#99F6E4",
    "muted_fg": "#64748B",
    "notes": "Caring teal + warm orange [Accent adjusted from #F97316 for WCAG 3:1]"
  },
  {
    "product": "Florist/Plant Shop",
    "primary": "#15803D",
    "secondary": "#22C55E",
    "accent": "#EC4899",
    "background": "#F0FDF4",
    "foreground": "#14532D",
    "card": "#FFFFFF",
    "muted": "#E8F0F1",
    "border": "#BBF7D0",
    "muted_fg": "#64748B",
    "notes": "Natural green + floral pink"
  },
  {
    "product": "Bakery/Cafe",
    "primary": "#92400E",
    "secondary": "#B45309",
    "accent": "#92400E",
    "background": "#FEF3C7",
    "foreground": "#78350F",
    "card": "#FFFFFF",
    "muted": "#EDEEF0",
    "border": "#FDE68A",
    "muted_fg": "#64748B",
    "notes": "Warm brown + cream white [Accent adjusted from #F8FAFC for WCAG 3:1]"
  },
  {
    "product": "Brewery/Winery",
    "primary": "#7C2D12",
    "secondary": "#B91C1C",
    "accent": "#A16207",
    "background": "#FEF2F2",
    "foreground": "#450A0A",
    "card": "#FFFFFF",
    "muted": "#ECEDF0",
    "border": "#FECACA",
    "muted_fg": "#64748B",
    "notes": "Deep burgundy + craft gold [Accent adjusted from #CA8A04 for WCAG 3:1]"
  },
  {
    "product": "Airline",
    "primary": "#1E3A8A",
    "secondary": "#3B82F6",
    "accent": "#EA580C",
    "background": "#EFF6FF",
    "foreground": "#1E40AF",
    "card": "#FFFFFF",
    "muted": "#E9EEF5",
    "border": "#BFDBFE",
    "muted_fg": "#64748B",
    "notes": "Sky blue + booking orange [Accent adjusted from #F97316 for WCAG 3:1]"
  },
  {
    "product": "News/Media Platform",
    "primary": "#DC2626",
    "secondary": "#EF4444",
    "accent": "#1E40AF",
    "background": "#FEF2F2",
    "foreground": "#450A0A",
    "card": "#FFFFFF",
    "muted": "#F0EDF1",
    "border": "#FECACA",
    "muted_fg": "#64748B",
    "notes": "Breaking red + link blue"
  },
  {
    "product": "Magazine/Blog",
    "primary": "#18181B",
    "secondary": "#3F3F46",
    "accent": "#EC4899",
    "background": "#FAFAFA",
    "foreground": "#09090B",
    "card": "#FFFFFF",
    "muted": "#E8ECF0",
    "border": "#E4E4E7",
    "muted_fg": "#64748B",
    "notes": "Editorial black + accent pink"
  },
  {
    "product": "Freelancer Platform",
    "primary": "#6366F1",
    "secondary": "#818CF8",
    "accent": "#16A34A",
    "background": "#EEF2FF",
    "foreground": "#312E81",
    "card": "#FFFFFF",
    "muted": "#EBEFF9",
    "border": "#C7D2FE",
    "muted_fg": "#64748B",
    "notes": "Creative indigo + hire green [Accent adjusted from #22C55E for WCAG 3:1]"
  },
  {
    "product": "Marketing Agency",
    "primary": "#EC4899",
    "secondary": "#F472B6",
    "accent": "#0891B2",
    "background": "#FDF2F8",
    "foreground": "#831843",
    "card": "#FFFFFF",
    "muted": "#F1EEF5",
    "border": "#FBCFE8",
    "muted_fg": "#64748B",
    "notes": "Bold pink + creative cyan [Accent adjusted from #06B6D4 for WCAG 3:1]"
  },
  {
    "product": "Event Management",
    "primary": "#7C3AED",
    "secondary": "#A78BFA",
    "accent": "#EA580C",
    "background": "#FAF5FF",
    "foreground": "#4C1D95",
    "card": "#FFFFFF",
    "muted": "#ECEEF9",
    "border": "#DDD6FE",
    "muted_fg": "#64748B",
    "notes": "Excitement purple + action orange [Accent adjusted from #F97316 for WCAG 3:1]"
  },
  {
    "product": "Membership/Community",
    "primary": "#7C3AED",
    "secondary": "#A78BFA",
    "accent": "#16A34A",
    "background": "#FAF5FF",
    "foreground": "#4C1D95",
    "card": "#FFFFFF",
    "muted": "#ECEEF9",
    "border": "#DDD6FE",
    "muted_fg": "#64748B",
    "notes": "Community purple + join green [Accent adjusted from #22C55E for WCAG 3:1]"
  },
  {
    "product": "Newsletter Platform",
    "primary": "#0369A1",
    "secondary": "#0EA5E9",
    "accent": "#EA580C",
    "background": "#F0F9FF",
    "foreground": "#0C4A6E",
    "card": "#FFFFFF",
    "muted": "#E7EFF5",
    "border": "#BAE6FD",
    "muted_fg": "#64748B",
    "notes": "Trust blue + subscribe orange [Accent adjusted from #F97316 for WCAG 3:1]"
  },
  {
    "product": "Digital Products/Downloads",
    "primary": "#6366F1",
    "secondary": "#818CF8",
    "accent": "#16A34A",
    "background": "#EEF2FF",
    "foreground": "#312E81",
    "card": "#FFFFFF",
    "muted": "#EBEFF9",
    "border": "#C7D2FE",
    "muted_fg": "#64748B",
    "notes": "Digital indigo + buy green [Accent adjusted from #22C55E for WCAG 3:1]"
  },
  {
    "product": "Church/Religious Organization",
    "primary": "#7C3AED",
    "secondary": "#A78BFA",
    "accent": "#A16207",
    "background": "#FAF5FF",
    "foreground": "#4C1D95",
    "card": "#FFFFFF",
    "muted": "#ECEEF9",
    "border": "#DDD6FE",
    "muted_fg": "#64748B",
    "notes": "Spiritual purple + warm gold [Accent adjusted from #CA8A04 for WCAG 3:1]"
  },
  {
    "product": "Sports Team/Club",
    "primary": "#DC2626",
    "secondary": "#EF4444",
    "accent": "#DC2626",
    "background": "#FEF2F2",
    "foreground": "#7F1D1D",
    "card": "#FFFFFF",
    "muted": "#F0EDF1",
    "border": "#FECACA",
    "muted_fg": "#64748B",
    "notes": "Team red + championship gold [Accent adjusted from #FBBF24 for WCAG 3:1]"
  },
  {
    "product": "Museum/Gallery",
    "primary": "#18181B",
    "secondary": "#27272A",
    "accent": "#18181B",
    "background": "#FAFAFA",
    "foreground": "#09090B",
    "card": "#FFFFFF",
    "muted": "#E8ECF0",
    "border": "#E4E4E7",
    "muted_fg": "#64748B",
    "notes": "Gallery black + white space [Accent adjusted from #F8FAFC for WCAG 3:1]"
  },
  {
    "product": "Theater/Cinema",
    "primary": "#1E1B4B",
    "secondary": "#312E81",
    "accent": "#CA8A04",
    "background": "#0F0F23",
    "foreground": "#F8FAFC",
    "card": "#1B1B30",
    "muted": "#27273B",
    "border": "#4338CA",
    "muted_fg": "#94A3B8",
    "notes": "Dramatic dark + spotlight gold"
  },
  {
    "product": "Language Learning App",
    "primary": "#4F46E5",
    "secondary": "#818CF8",
    "accent": "#16A34A",
    "background": "#EEF2FF",
    "foreground": "#312E81",
    "card": "#FFFFFF",
    "muted": "#EBEEF8",
    "border": "#C7D2FE",
    "muted_fg": "#64748B",
    "notes": "Learning indigo + progress green [Accent adjusted from #22C55E for WCAG 3:1]"
  },
  {
    "product": "Coding Bootcamp",
    "primary": "#0F172A",
    "secondary": "#1E293B",
    "accent": "#22C55E",
    "background": "#020617",
    "foreground": "#F8FAFC",
    "card": "#0E1223",
    "muted": "#1A1E2F",
    "border": "#334155",
    "muted_fg": "#94A3B8",
    "notes": "Terminal dark + success green"
  },
  {
    "product": "Cybersecurity Platform",
    "primary": "#00FF41",
    "secondary": "#0D0D0D",
    "accent": "#FF3333",
    "background": "#000000",
    "foreground": "#E0E0E0",
    "card": "#0C130E",
    "muted": "#181818",
    "border": "#1F1F1F",
    "muted_fg": "#94A3B8",
    "notes": "Matrix green + alert red"
  },
  {
    "product": "Developer Tool / IDE",
    "primary": "#1E293B",
    "secondary": "#334155",
    "accent": "#22C55E",
    "background": "#0F172A",
    "foreground": "#F8FAFC",
    "card": "#1B2336",
    "muted": "#272F42",
    "border": "#475569",
    "muted_fg": "#94A3B8",
    "notes": "Code dark + run green"
  },
  {
    "product": "Biotech / Life Sciences",
    "primary": "#0EA5E9",
    "secondary": "#0284C7",
    "accent": "#059669",
    "background": "#F0F9FF",
    "foreground": "#0C4A6E",
    "card": "#FFFFFF",
    "muted": "#E8F2F8",
    "border": "#BAE6FD",
    "muted_fg": "#64748B",
    "notes": "DNA blue + life green [Accent adjusted from #10B981 for WCAG 3:1]"
  },
  {
    "product": "Space Tech / Aerospace",
    "primary": "#F8FAFC",
    "secondary": "#94A3B8",
    "accent": "#3B82F6",
    "background": "#0B0B10",
    "foreground": "#F8FAFC",
    "card": "#1E1E23",
    "muted": "#232328",
    "border": "#1E293B",
    "muted_fg": "#94A3B8",
    "notes": "Star white + launch blue"
  },
  {
    "product": "Architecture / Interior",
    "primary": "#171717",
    "secondary": "#404040",
    "accent": "#A16207",
    "background": "#FFFFFF",
    "foreground": "#171717",
    "card": "#FFFFFF",
    "muted": "#E8ECF0",
    "border": "#E5E5E5",
    "muted_fg": "#64748B",
    "notes": "Minimal black + accent gold [Accent adjusted from #D4AF37 for WCAG 3:1]"
  },
  {
    "product": "Quantum Computing Interface",
    "primary": "#00FFFF",
    "secondary": "#7B61FF",
    "accent": "#FF00FF",
    "background": "#050510",
    "foreground": "#E0E0FF",
    "card": "#101823",
    "muted": "#1D1D28",
    "border": "#333344",
    "muted_fg": "#94A3B8",
    "notes": "Quantum cyan + interference purple"
  },
  {
    "product": "Biohacking / Longevity App",
    "primary": "#FF4D4D",
    "secondary": "#4D94FF",
    "accent": "#059669",
    "background": "#F5F5F7",
    "foreground": "#1C1C1E",
    "card": "#FFFFFF",
    "muted": "#F2EEF2",
    "border": "#E5E5EA",
    "muted_fg": "#64748B",
    "notes": "Bio red/blue + vitality green [Accent adjusted from #00E676 for WCAG 3:1]"
  },
  {
    "product": "Autonomous Drone Fleet Manager",
    "primary": "#00FF41",
    "secondary": "#008F11",
    "accent": "#FF3333",
    "background": "#0D1117",
    "foreground": "#E6EDF3",
    "card": "#182424",
    "muted": "#25292F",
    "border": "#30363D",
    "muted_fg": "#94A3B8",
    "notes": "Terminal green + alert red"
  },
  {
    "product": "Generative Art Platform",
    "primary": "#18181B",
    "secondary": "#3F3F46",
    "accent": "#EC4899",
    "background": "#FAFAFA",
    "foreground": "#09090B",
    "card": "#FFFFFF",
    "muted": "#E8ECF0",
    "border": "#E4E4E7",
    "muted_fg": "#64748B",
    "notes": "Canvas neutral + creative pink"
  },
  {
    "product": "Spatial Computing OS / App",
    "primary": "#FFFFFF",
    "secondary": "#E5E5E5",
    "accent": "#FFFFFF",
    "background": "#888888",
    "foreground": "#000000",
    "card": "#999999",
    "muted": "#777777",
    "border": "#CCCCCC",
    "muted_fg": "#D4D4D4",
    "notes": "Glass white + system blue [Accent adjusted from #007AFF for WCAG 3:1]"
  },
  {
    "product": "Sustainable Energy / Climate Tech",
    "primary": "#059669",
    "secondary": "#10B981",
    "accent": "#059669",
    "background": "#ECFDF5",
    "foreground": "#064E3B",
    "card": "#FFFFFF",
    "muted": "#E8F1F3",
    "border": "#A7F3D0",
    "muted_fg": "#64748B",
    "notes": "Nature green + solar gold [Accent adjusted from #FBBF24 for WCAG 3:1]"
  },
  {
    "product": "Personal Finance Tracker",
    "primary": "#1E40AF",
    "secondary": "#3B82F6",
    "accent": "#059669",
    "background": "#0F172A",
    "foreground": "#FFFFFF",
    "card": "#192134",
    "muted": "#101A34",
    "border": "rgba(255,255,255,0.08)",
    "muted_fg": "#94A3B8",
    "notes": "Trust blue + profit green on dark"
  },
  {
    "product": "Chat & Messaging App",
    "primary": "#2563EB",
    "secondary": "#6366F1",
    "accent": "#059669",
    "background": "#FFFFFF",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F1F5FD",
    "border": "#E4ECFC",
    "muted_fg": "#64748B",
    "notes": "Messenger blue + online green"
  },
  {
    "product": "Notes & Writing App",
    "primary": "#78716C",
    "secondary": "#A8A29E",
    "accent": "#D97706",
    "background": "#FFFBEB",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F6F6F6",
    "border": "#EEEDED",
    "muted_fg": "#64748B",
    "notes": "Warm ink + amber accent on cream"
  },
  {
    "product": "Habit Tracker",
    "primary": "#D97706",
    "secondary": "#F59E0B",
    "accent": "#059669",
    "background": "#FFFBEB",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#FCF6F0",
    "border": "#FAEEE1",
    "muted_fg": "#64748B",
    "notes": "Streak amber + habit green"
  },
  {
    "product": "Food Delivery / On-Demand",
    "primary": "#EA580C",
    "secondary": "#F97316",
    "accent": "#2563EB",
    "background": "#FFF7ED",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#FDF4F0",
    "border": "#FCEAE1",
    "muted_fg": "#64748B",
    "notes": "Appetizing orange + trust blue"
  },
  {
    "product": "Ride Hailing / Transportation",
    "primary": "#1E293B",
    "secondary": "#334155",
    "accent": "#2563EB",
    "background": "#0F172A",
    "foreground": "#FFFFFF",
    "card": "#192134",
    "muted": "#10182B",
    "border": "rgba(255,255,255,0.08)",
    "muted_fg": "#94A3B8",
    "notes": "Map dark + route blue"
  },
  {
    "product": "Recipe & Cooking App",
    "primary": "#9A3412",
    "secondary": "#C2410C",
    "accent": "#059669",
    "background": "#FFFBEB",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F8F2F0",
    "border": "#F2E6E2",
    "muted_fg": "#64748B",
    "notes": "Warm terracotta + fresh green"
  },
  {
    "product": "Meditation & Mindfulness",
    "primary": "#7C3AED",
    "secondary": "#8B5CF6",
    "accent": "#059669",
    "background": "#FAF5FF",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F7F3FD",
    "border": "#EFE7FC",
    "muted_fg": "#64748B",
    "notes": "Calm lavender + mindful green"
  },
  {
    "product": "Weather App",
    "primary": "#0284C7",
    "secondary": "#0EA5E9",
    "accent": "#F59E0B",
    "background": "#F0F9FF",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#EFF7FB",
    "border": "#E0F0F8",
    "muted_fg": "#64748B",
    "notes": "Sky blue + sun amber"
  },
  {
    "product": "Diary & Journal App",
    "primary": "#92400E",
    "secondary": "#A16207",
    "accent": "#6366F1",
    "background": "#FFFBEB",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F8F3F0",
    "border": "#F1E8E2",
    "muted_fg": "#64748B",
    "notes": "Warm journal brown + ink violet"
  },
  {
    "product": "CRM & Client Management",
    "primary": "#2563EB",
    "secondary": "#3B82F6",
    "accent": "#059669",
    "background": "#F8FAFC",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F1F5FD",
    "border": "#E4ECFC",
    "muted_fg": "#64748B",
    "notes": "Professional blue + deal green"
  },
  {
    "product": "Inventory & Stock Management",
    "primary": "#334155",
    "secondary": "#475569",
    "accent": "#059669",
    "background": "#F8FAFC",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F2F3F4",
    "border": "#E6E8EA",
    "muted_fg": "#64748B",
    "notes": "Industrial slate + stock green"
  },
  {
    "product": "Flashcard & Study Tool",
    "primary": "#7C3AED",
    "secondary": "#8B5CF6",
    "accent": "#059669",
    "background": "#FAF5FF",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F7F3FD",
    "border": "#EFE7FC",
    "muted_fg": "#64748B",
    "notes": "Study purple + correct green"
  },
  {
    "product": "Booking & Appointment App",
    "primary": "#0284C7",
    "secondary": "#0EA5E9",
    "accent": "#059669",
    "background": "#F0F9FF",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#EFF7FB",
    "border": "#E0F0F8",
    "muted_fg": "#64748B",
    "notes": "Calendar blue + available green"
  },
  {
    "product": "Invoice & Billing Tool",
    "primary": "#1E3A5F",
    "secondary": "#2563EB",
    "accent": "#059669",
    "background": "#F8FAFC",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F1F3F5",
    "border": "#E4E7EB",
    "muted_fg": "#64748B",
    "notes": "Navy professional + paid green"
  },
  {
    "product": "Grocery & Shopping List",
    "primary": "#059669",
    "secondary": "#10B981",
    "accent": "#D97706",
    "background": "#ECFDF5",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F0F8F6",
    "border": "#E1F2ED",
    "muted_fg": "#64748B",
    "notes": "Fresh green + food amber"
  },
  {
    "product": "Timer & Pomodoro",
    "primary": "#DC2626",
    "secondary": "#EF4444",
    "accent": "#059669",
    "background": "#0F172A",
    "foreground": "#FFFFFF",
    "card": "#192134",
    "muted": "#1F1829",
    "border": "rgba(255,255,255,0.08)",
    "muted_fg": "#94A3B8",
    "notes": "Focus red on dark + break green"
  },
  {
    "product": "Parenting & Baby Tracker",
    "primary": "#EC4899",
    "secondary": "#F472B6",
    "accent": "#0284C7",
    "background": "#FDF2F8",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#FDF4F8",
    "border": "#FCE9F2",
    "muted_fg": "#64748B",
    "notes": "Soft pink + trust blue"
  },
  {
    "product": "Scanner & Document Manager",
    "primary": "#1E293B",
    "secondary": "#334155",
    "accent": "#2563EB",
    "background": "#F8FAFC",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F1F2F3",
    "border": "#E4E5E7",
    "muted_fg": "#64748B",
    "notes": "Document grey + scan blue"
  },
  {
    "product": "Calendar & Scheduling App",
    "primary": "#2563EB",
    "secondary": "#3B82F6",
    "accent": "#059669",
    "background": "#F8FAFC",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F1F5FD",
    "border": "#E4ECFC",
    "muted_fg": "#64748B",
    "notes": "Calendar blue + event green"
  },
  {
    "product": "Password Manager",
    "primary": "#1E3A5F",
    "secondary": "#334155",
    "accent": "#059669",
    "background": "#0F172A",
    "foreground": "#FFFFFF",
    "card": "#192134",
    "muted": "#10192E",
    "border": "rgba(255,255,255,0.08)",
    "muted_fg": "#94A3B8",
    "notes": "Vault dark blue + secure green"
  },
  {
    "product": "Expense Splitter / Bill Split",
    "primary": "#059669",
    "secondary": "#10B981",
    "accent": "#DC2626",
    "background": "#F8FAFC",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F0F8F6",
    "border": "#E1F2ED",
    "muted_fg": "#64748B",
    "notes": "Balance green + owe red"
  },
  {
    "product": "Voice Recorder & Memo",
    "primary": "#DC2626",
    "secondary": "#EF4444",
    "accent": "#2563EB",
    "background": "#FFFFFF",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#FCF1F1",
    "border": "#FAE4E4",
    "muted_fg": "#64748B",
    "notes": "Recording red + waveform blue"
  },
  {
    "product": "Bookmark & Read-Later",
    "primary": "#D97706",
    "secondary": "#F59E0B",
    "accent": "#2563EB",
    "background": "#FFFBEB",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#FCF6F0",
    "border": "#FAEEE1",
    "muted_fg": "#64748B",
    "notes": "Warm amber + link blue"
  },
  {
    "product": "Translator App",
    "primary": "#2563EB",
    "secondary": "#0891B2",
    "accent": "#EA580C",
    "background": "#F8FAFC",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F1F5FD",
    "border": "#E4ECFC",
    "muted_fg": "#64748B",
    "notes": "Global blue + teal + accent orange"
  },
  {
    "product": "Calculator & Unit Converter",
    "primary": "#EA580C",
    "secondary": "#F97316",
    "accent": "#2563EB",
    "background": "#1C1917",
    "foreground": "#FFFFFF",
    "card": "#262321",
    "muted": "#2C1E16",
    "border": "rgba(255,255,255,0.08)",
    "muted_fg": "#94A3B8",
    "notes": "Operation orange on dark"
  },
  {
    "product": "Alarm & World Clock",
    "primary": "#D97706",
    "secondary": "#F59E0B",
    "accent": "#6366F1",
    "background": "#0F172A",
    "foreground": "#FFFFFF",
    "card": "#192134",
    "muted": "#1F1E27",
    "border": "rgba(255,255,255,0.08)",
    "muted_fg": "#94A3B8",
    "notes": "Time amber + night indigo on dark"
  },
  {
    "product": "File Manager & Transfer",
    "primary": "#2563EB",
    "secondary": "#3B82F6",
    "accent": "#D97706",
    "background": "#F8FAFC",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F1F5FD",
    "border": "#E4ECFC",
    "muted_fg": "#64748B",
    "notes": "Folder blue + file amber"
  },
  {
    "product": "Email Client",
    "primary": "#2563EB",
    "secondary": "#3B82F6",
    "accent": "#DC2626",
    "background": "#FFFFFF",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F1F5FD",
    "border": "#E4ECFC",
    "muted_fg": "#64748B",
    "notes": "Inbox blue + priority red"
  },
  {
    "product": "Casual Puzzle Game",
    "primary": "#EC4899",
    "secondary": "#8B5CF6",
    "accent": "#F59E0B",
    "background": "#FDF2F8",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#FDF4F8",
    "border": "#FCE9F2",
    "muted_fg": "#64748B",
    "notes": "Cheerful pink + reward gold"
  },
  {
    "product": "Trivia & Quiz Game",
    "primary": "#2563EB",
    "secondary": "#7C3AED",
    "accent": "#F59E0B",
    "background": "#EFF6FF",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F1F5FD",
    "border": "#E4ECFC",
    "muted_fg": "#64748B",
    "notes": "Quiz blue + gold leaderboard"
  },
  {
    "product": "Card & Board Game",
    "primary": "#15803D",
    "secondary": "#166534",
    "accent": "#D97706",
    "background": "#0F172A",
    "foreground": "#FFFFFF",
    "card": "#192134",
    "muted": "#0F1F2B",
    "border": "rgba(255,255,255,0.08)",
    "muted_fg": "#94A3B8",
    "notes": "Felt green + gold on dark"
  },
  {
    "product": "Idle & Clicker Game",
    "primary": "#D97706",
    "secondary": "#F59E0B",
    "accent": "#7C3AED",
    "background": "#FFFBEB",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#FCF6F0",
    "border": "#FAEEE1",
    "muted_fg": "#64748B",
    "notes": "Coin gold + prestige purple"
  },
  {
    "product": "Word & Crossword Game",
    "primary": "#15803D",
    "secondary": "#059669",
    "accent": "#D97706",
    "background": "#FFFFFF",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F0F7F3",
    "border": "#E2EFE7",
    "muted_fg": "#64748B",
    "notes": "Word green + letter amber"
  },
  {
    "product": "Arcade & Retro Game",
    "primary": "#DC2626",
    "secondary": "#2563EB",
    "accent": "#22C55E",
    "background": "#0F172A",
    "foreground": "#FFFFFF",
    "card": "#192134",
    "muted": "#1F1829",
    "border": "rgba(255,255,255,0.08)",
    "muted_fg": "#94A3B8",
    "notes": "Neon red+blue on dark + score green"
  },
  {
    "product": "Photo Editor & Filters",
    "primary": "#7C3AED",
    "secondary": "#6366F1",
    "accent": "#0891B2",
    "background": "#0F172A",
    "foreground": "#FFFFFF",
    "card": "#192134",
    "muted": "#171939",
    "border": "rgba(255,255,255,0.08)",
    "muted_fg": "#94A3B8",
    "notes": "Editor violet + filter cyan on dark"
  },
  {
    "product": "Short Video Editor",
    "primary": "#EC4899",
    "secondary": "#DB2777",
    "accent": "#2563EB",
    "background": "#0F172A",
    "foreground": "#FFFFFF",
    "card": "#192134",
    "muted": "#201A32",
    "border": "rgba(255,255,255,0.08)",
    "muted_fg": "#94A3B8",
    "notes": "Video pink on dark + timeline blue"
  },
  {
    "product": "Drawing & Sketching Canvas",
    "primary": "#7C3AED",
    "secondary": "#8B5CF6",
    "accent": "#0891B2",
    "background": "#1C1917",
    "foreground": "#FFFFFF",
    "card": "#262321",
    "muted": "#231B28",
    "border": "rgba(255,255,255,0.08)",
    "muted_fg": "#94A3B8",
    "notes": "Canvas purple + tool teal on dark"
  },
  {
    "product": "Music Creation & Beat Maker",
    "primary": "#7C3AED",
    "secondary": "#6366F1",
    "accent": "#22C55E",
    "background": "#0F172A",
    "foreground": "#FFFFFF",
    "card": "#192134",
    "muted": "#171939",
    "border": "rgba(255,255,255,0.08)",
    "muted_fg": "#94A3B8",
    "notes": "Studio purple + waveform green on dark"
  },
  {
    "product": "Meme & Sticker Maker",
    "primary": "#EC4899",
    "secondary": "#F59E0B",
    "accent": "#2563EB",
    "background": "#FFFFFF",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#FDF4F8",
    "border": "#FCE9F2",
    "muted_fg": "#64748B",
    "notes": "Viral pink + comedy yellow + share blue"
  },
  {
    "product": "AI Photo & Avatar Generator",
    "primary": "#7C3AED",
    "secondary": "#6366F1",
    "accent": "#EC4899",
    "background": "#FAF5FF",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F7F3FD",
    "border": "#EFE7FC",
    "muted_fg": "#64748B",
    "notes": "AI purple + generation pink"
  },
  {
    "product": "Link-in-Bio Page Builder",
    "primary": "#2563EB",
    "secondary": "#7C3AED",
    "accent": "#EC4899",
    "background": "#FFFFFF",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F1F5FD",
    "border": "#E4ECFC",
    "muted_fg": "#64748B",
    "notes": "Brand blue + creator purple"
  },
  {
    "product": "Wardrobe & Outfit Planner",
    "primary": "#BE185D",
    "secondary": "#EC4899",
    "accent": "#D97706",
    "background": "#FDF2F8",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#FBF1F5",
    "border": "#F7E3EB",
    "muted_fg": "#64748B",
    "notes": "Fashion rose + gold accent"
  },
  {
    "product": "Plant Care Tracker",
    "primary": "#15803D",
    "secondary": "#059669",
    "accent": "#D97706",
    "background": "#F0FDF4",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F0F7F3",
    "border": "#E2EFE7",
    "muted_fg": "#64748B",
    "notes": "Nature green + sun yellow"
  },
  {
    "product": "Book & Reading Tracker",
    "primary": "#78716C",
    "secondary": "#92400E",
    "accent": "#D97706",
    "background": "#FFFBEB",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F6F6F6",
    "border": "#EEEDED",
    "muted_fg": "#64748B",
    "notes": "Book brown + page amber"
  },
  {
    "product": "Couple & Relationship App",
    "primary": "#BE185D",
    "secondary": "#EC4899",
    "accent": "#DC2626",
    "background": "#FDF2F8",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#FBF1F5",
    "border": "#F7E3EB",
    "muted_fg": "#64748B",
    "notes": "Romance rose + love red"
  },
  {
    "product": "Family Calendar & Chores",
    "primary": "#2563EB",
    "secondary": "#059669",
    "accent": "#D97706",
    "background": "#F8FAFC",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F1F5FD",
    "border": "#E4ECFC",
    "muted_fg": "#64748B",
    "notes": "Family blue + chore green"
  },
  {
    "product": "Mood Tracker",
    "primary": "#7C3AED",
    "secondary": "#6366F1",
    "accent": "#D97706",
    "background": "#FAF5FF",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F7F3FD",
    "border": "#EFE7FC",
    "muted_fg": "#64748B",
    "notes": "Mood purple + insight amber"
  },
  {
    "product": "Gift & Wishlist",
    "primary": "#DC2626",
    "secondary": "#D97706",
    "accent": "#EC4899",
    "background": "#FFF1F2",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#FCF1F1",
    "border": "#FAE4E4",
    "muted_fg": "#64748B",
    "notes": "Gift red + gold + surprise pink"
  },
  {
    "product": "Running & Cycling GPS",
    "primary": "#EA580C",
    "secondary": "#F97316",
    "accent": "#059669",
    "background": "#0F172A",
    "foreground": "#FFFFFF",
    "card": "#192134",
    "muted": "#201C27",
    "border": "rgba(255,255,255,0.08)",
    "muted_fg": "#94A3B8",
    "notes": "Energetic orange + pace green on dark"
  },
  {
    "product": "Yoga & Stretching Guide",
    "primary": "#6B7280",
    "secondary": "#78716C",
    "accent": "#0891B2",
    "background": "#F5F5F0",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F6F6F7",
    "border": "#EDEEEF",
    "muted_fg": "#64748B",
    "notes": "Sage neutral + calm teal"
  },
  {
    "product": "Sleep Tracker",
    "primary": "#4338CA",
    "secondary": "#6366F1",
    "accent": "#7C3AED",
    "background": "#0F172A",
    "foreground": "#FFFFFF",
    "card": "#192134",
    "muted": "#131936",
    "border": "rgba(255,255,255,0.08)",
    "muted_fg": "#94A3B8",
    "notes": "Night indigo + dream violet on dark"
  },
  {
    "product": "Calorie & Nutrition Counter",
    "primary": "#059669",
    "secondary": "#10B981",
    "accent": "#EA580C",
    "background": "#ECFDF5",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F0F8F6",
    "border": "#E1F2ED",
    "muted_fg": "#64748B",
    "notes": "Healthy green + macro orange"
  },
  {
    "product": "Period & Cycle Tracker",
    "primary": "#BE185D",
    "secondary": "#EC4899",
    "accent": "#7C3AED",
    "background": "#FDF2F8",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#FBF1F5",
    "border": "#F7E3EB",
    "muted_fg": "#64748B",
    "notes": "Blush rose + fertility lavender"
  },
  {
    "product": "Medication & Pill Reminder",
    "primary": "#0284C7",
    "secondary": "#0891B2",
    "accent": "#DC2626",
    "background": "#F0F9FF",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#EFF7FB",
    "border": "#E0F0F8",
    "muted_fg": "#64748B",
    "notes": "Medical blue + alert red"
  },
  {
    "product": "Water & Hydration Reminder",
    "primary": "#0284C7",
    "secondary": "#06B6D4",
    "accent": "#0891B2",
    "background": "#F0F9FF",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#EFF7FB",
    "border": "#E0F0F8",
    "muted_fg": "#64748B",
    "notes": "Refreshing blue + water cyan"
  },
  {
    "product": "Fasting & Intermittent Timer",
    "primary": "#6366F1",
    "secondary": "#4338CA",
    "accent": "#059669",
    "background": "#0F172A",
    "foreground": "#FFFFFF",
    "card": "#192134",
    "muted": "#151D39",
    "border": "rgba(255,255,255,0.08)",
    "muted_fg": "#94A3B8",
    "notes": "Fasting indigo on dark + eating green"
  },
  {
    "product": "Anonymous Community / Confession",
    "primary": "#475569",
    "secondary": "#334155",
    "accent": "#0891B2",
    "background": "#0F172A",
    "foreground": "#FFFFFF",
    "card": "#192134",
    "muted": "#131B2F",
    "border": "rgba(255,255,255,0.08)",
    "muted_fg": "#94A3B8",
    "notes": "Protective grey + subtle teal on dark"
  },
  {
    "product": "Local Events & Discovery",
    "primary": "#EA580C",
    "secondary": "#F97316",
    "accent": "#2563EB",
    "background": "#FFF7ED",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#FDF4F0",
    "border": "#FCEAE1",
    "muted_fg": "#64748B",
    "notes": "Event orange + map blue"
  },
  {
    "product": "Study Together / Virtual Coworking",
    "primary": "#2563EB",
    "secondary": "#3B82F6",
    "accent": "#059669",
    "background": "#F8FAFC",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F1F5FD",
    "border": "#E4ECFC",
    "muted_fg": "#64748B",
    "notes": "Focus blue + session green"
  },
  {
    "product": "Coding Challenge & Practice",
    "primary": "#22C55E",
    "secondary": "#059669",
    "accent": "#D97706",
    "background": "#0F172A",
    "foreground": "#FFFFFF",
    "card": "#192134",
    "muted": "#10242E",
    "border": "rgba(255,255,255,0.08)",
    "muted_fg": "#94A3B8",
    "notes": "Code green + difficulty amber on dark"
  },
  {
    "product": "Kids Learning (ABC & Math)",
    "primary": "#2563EB",
    "secondary": "#F59E0B",
    "accent": "#EC4899",
    "background": "#EFF6FF",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F1F5FD",
    "border": "#E4ECFC",
    "muted_fg": "#64748B",
    "notes": "Learning blue + play yellow + fun pink"
  },
  {
    "product": "Music Instrument Learning",
    "primary": "#DC2626",
    "secondary": "#9A3412",
    "accent": "#D97706",
    "background": "#FFFBEB",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#FCF1F1",
    "border": "#FAE4E4",
    "muted_fg": "#64748B",
    "notes": "Musical red + warm amber"
  },
  {
    "product": "Parking Finder",
    "primary": "#2563EB",
    "secondary": "#059669",
    "accent": "#DC2626",
    "background": "#F0F9FF",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F1F5FD",
    "border": "#E4ECFC",
    "muted_fg": "#64748B",
    "notes": "Available blue/green + occupied red"
  },
  {
    "product": "Public Transit Guide",
    "primary": "#2563EB",
    "secondary": "#0891B2",
    "accent": "#EA580C",
    "background": "#F8FAFC",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F1F5FD",
    "border": "#E4ECFC",
    "muted_fg": "#64748B",
    "notes": "Transit blue + line colors"
  },
  {
    "product": "Road Trip Planner",
    "primary": "#EA580C",
    "secondary": "#0891B2",
    "accent": "#D97706",
    "background": "#FFF7ED",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#FDF4F0",
    "border": "#FCEAE1",
    "muted_fg": "#64748B",
    "notes": "Adventure orange + map teal"
  },
  {
    "product": "VPN & Privacy Tool",
    "primary": "#1E3A5F",
    "secondary": "#334155",
    "accent": "#22C55E",
    "background": "#0F172A",
    "foreground": "#FFFFFF",
    "card": "#192134",
    "muted": "#10192E",
    "border": "rgba(255,255,255,0.08)",
    "muted_fg": "#94A3B8",
    "notes": "Shield dark + connected green"
  },
  {
    "product": "Emergency SOS & Safety",
    "primary": "#DC2626",
    "secondary": "#EF4444",
    "accent": "#2563EB",
    "background": "#FFF1F2",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#FCF1F1",
    "border": "#FAE4E4",
    "muted_fg": "#64748B",
    "notes": "Alert red + safety blue"
  },
  {
    "product": "Wallpaper & Theme App",
    "primary": "#7C3AED",
    "secondary": "#EC4899",
    "accent": "#2563EB",
    "background": "#FAF5FF",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F7F3FD",
    "border": "#EFE7FC",
    "muted_fg": "#64748B",
    "notes": "Aesthetic purple + trending pink"
  },
  {
    "product": "White Noise & Ambient Sound",
    "primary": "#475569",
    "secondary": "#334155",
    "accent": "#4338CA",
    "background": "#0F172A",
    "foreground": "#FFFFFF",
    "card": "#192134",
    "muted": "#131B2F",
    "border": "rgba(255,255,255,0.08)",
    "muted_fg": "#94A3B8",
    "notes": "Ambient grey + deep indigo on dark"
  },
  {
    "product": "Home Decoration & Interior Design",
    "primary": "#78716C",
    "secondary": "#A8A29E",
    "accent": "#D97706",
    "background": "#FAF5F2",
    "foreground": "#0F172A",
    "card": "#FFFFFF",
    "muted": "#F6F6F6",
    "border": "#EEEDED",
    "muted_fg": "#64748B",
    "notes": "Interior warm grey + gold accent"
  }
];

export const TYPOGRAPHY_PAIRINGS: Typography[] = [
  {
    "name": "Classic Elegant",
    "category": "Serif + Sans",
    "heading": "Playfair Display",
    "body": "Inter",
    "mood": "elegant, luxury, sophisticated, timeless, premium, editorial",
    "best_for": "Luxury brands, fashion, spa, beauty, editorial, magazines, high-end e-commerce",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:wght@400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { serif: ['Playfair Display', 'serif'], sans: ['Inter', 'sans-serif'] }"
  },
  {
    "name": "Modern Professional",
    "category": "Sans + Sans",
    "heading": "Poppins",
    "body": "Open Sans",
    "mood": "modern, professional, clean, corporate, friendly, approachable",
    "best_for": "SaaS, corporate sites, business apps, startups, professional services",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;500;600;700&family=Poppins:wght@400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { heading: ['Poppins', 'sans-serif'], body: ['Open Sans', 'sans-serif'] }"
  },
  {
    "name": "Tech Startup",
    "category": "Sans + Sans",
    "heading": "Space Grotesk",
    "body": "DM Sans",
    "mood": "tech, startup, modern, innovative, bold, futuristic",
    "best_for": "Tech companies, startups, SaaS, developer tools, AI products",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { heading: ['Space Grotesk', 'sans-serif'], body: ['DM Sans', 'sans-serif'] }"
  },
  {
    "name": "Editorial Classic",
    "category": "Serif + Serif",
    "heading": "Cormorant Garamond",
    "body": "Libre Baskerville",
    "mood": "editorial, classic, literary, traditional, refined, bookish",
    "best_for": "Publishing, blogs, news sites, literary magazines, book covers",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Libre+Baskerville:wght@400;700&display=swap');",
    "tailwind": "fontFamily: { heading: ['Cormorant Garamond', 'serif'], body: ['Libre Baskerville', 'serif'] }"
  },
  {
    "name": "Minimal Swiss",
    "category": "Sans + Sans",
    "heading": "Inter",
    "body": "Inter",
    "mood": "minimal, clean, swiss, functional, neutral, professional",
    "best_for": "Dashboards, admin panels, documentation, enterprise apps, design systems",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { sans: ['Inter', 'sans-serif'] }"
  },
  {
    "name": "Playful Creative",
    "category": "Display + Sans",
    "heading": "Fredoka",
    "body": "Nunito",
    "mood": "playful, friendly, fun, creative, warm, approachable",
    "best_for": "Children's apps, educational, gaming, creative tools, entertainment",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Nunito:wght@300;400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { heading: ['Fredoka', 'sans-serif'], body: ['Nunito', 'sans-serif'] }"
  },
  {
    "name": "Bold Statement",
    "category": "Display + Sans",
    "heading": "Bebas Neue",
    "body": "Source Sans 3",
    "mood": "bold, impactful, strong, dramatic, modern, headlines",
    "best_for": "Marketing sites, portfolios, agencies, event pages, sports",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Source+Sans+3:wght@300;400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { display: ['Bebas Neue', 'sans-serif'], body: ['Source Sans 3', 'sans-serif'] }"
  },
  {
    "name": "Wellness Calm",
    "category": "Serif + Sans",
    "heading": "Lora",
    "body": "Raleway",
    "mood": "calm, wellness, health, relaxing, natural, organic",
    "best_for": "Health apps, wellness, spa, meditation, yoga, organic brands",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Lora:wght@400;500;600;700&family=Raleway:wght@300;400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { serif: ['Lora', 'serif'], sans: ['Raleway', 'sans-serif'] }"
  },
  {
    "name": "Developer Mono",
    "category": "Mono + Sans",
    "heading": "JetBrains Mono",
    "body": "IBM Plex Sans",
    "mood": "code, developer, technical, precise, functional, hacker",
    "best_for": "Developer tools, documentation, code editors, tech blogs, CLI apps",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { mono: ['JetBrains Mono', 'monospace'], sans: ['IBM Plex Sans', 'sans-serif'] }"
  },
  {
    "name": "Retro Vintage",
    "category": "Display + Serif",
    "heading": "Abril Fatface",
    "body": "Merriweather",
    "mood": "retro, vintage, nostalgic, dramatic, decorative, bold",
    "best_for": "Vintage brands, breweries, restaurants, creative portfolios, posters",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Abril+Fatface&family=Merriweather:wght@300;400;700&display=swap');",
    "tailwind": "fontFamily: { display: ['Abril Fatface', 'serif'], body: ['Merriweather', 'serif'] }"
  },
  {
    "name": "Geometric Modern",
    "category": "Sans + Sans",
    "heading": "Outfit",
    "body": "Work Sans",
    "mood": "geometric, modern, clean, balanced, contemporary, versatile",
    "best_for": "General purpose, portfolios, agencies, modern brands, landing pages",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Work+Sans:wght@300;400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { heading: ['Outfit', 'sans-serif'], body: ['Work Sans', 'sans-serif'] }"
  },
  {
    "name": "Luxury Serif",
    "category": "Serif + Sans",
    "heading": "Cormorant",
    "body": "Montserrat",
    "mood": "luxury, high-end, fashion, elegant, refined, premium",
    "best_for": "Fashion brands, luxury e-commerce, jewelry, high-end services",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Cormorant:wght@400;500;600;700&family=Montserrat:wght@300;400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { serif: ['Cormorant', 'serif'], sans: ['Montserrat', 'sans-serif'] }"
  },
  {
    "name": "Friendly SaaS",
    "category": "Sans + Sans",
    "heading": "Plus Jakarta Sans",
    "body": "Plus Jakarta Sans",
    "mood": "friendly, modern, saas, clean, approachable, professional",
    "best_for": "SaaS products, web apps, dashboards, B2B, productivity tools",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { sans: ['Plus Jakarta Sans', 'sans-serif'] }"
  },
  {
    "name": "News Editorial",
    "category": "Serif + Sans",
    "heading": "Newsreader",
    "body": "Roboto",
    "mood": "news, editorial, journalism, trustworthy, readable, informative",
    "best_for": "News sites, blogs, magazines, journalism, content-heavy sites",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Newsreader:wght@400;500;600;700&family=Roboto:wght@300;400;500;700&display=swap');",
    "tailwind": "fontFamily: { serif: ['Newsreader', 'serif'], sans: ['Roboto', 'sans-serif'] }"
  },
  {
    "name": "Handwritten Charm",
    "category": "Script + Sans",
    "heading": "Caveat",
    "body": "Quicksand",
    "mood": "handwritten, personal, friendly, casual, warm, charming",
    "best_for": "Personal blogs, invitations, creative portfolios, lifestyle brands",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Caveat:wght@400;500;600;700&family=Quicksand:wght@300;400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { script: ['Caveat', 'cursive'], sans: ['Quicksand', 'sans-serif'] }"
  },
  {
    "name": "Corporate Trust",
    "category": "Sans + Sans",
    "heading": "Lexend",
    "body": "Source Sans 3",
    "mood": "corporate, trustworthy, accessible, readable, professional, clean",
    "best_for": "Enterprise, government, healthcare, finance, accessibility-focused",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500;600;700&family=Source+Sans+3:wght@300;400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { heading: ['Lexend', 'sans-serif'], body: ['Source Sans 3', 'sans-serif'] }"
  },
  {
    "name": "Brutalist Raw",
    "category": "Mono + Mono",
    "heading": "Space Mono",
    "body": "Space Mono",
    "mood": "brutalist, raw, technical, monospace, minimal, stark",
    "best_for": "Brutalist designs, developer portfolios, experimental, tech art",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');",
    "tailwind": "fontFamily: { mono: ['Space Mono', 'monospace'] }"
  },
  {
    "name": "Fashion Forward",
    "category": "Sans + Sans",
    "heading": "Syne",
    "body": "Manrope",
    "mood": "fashion, avant-garde, creative, bold, artistic, edgy",
    "best_for": "Fashion brands, creative agencies, art galleries, design studios",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Syne:wght@400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { heading: ['Syne', 'sans-serif'], body: ['Manrope', 'sans-serif'] }"
  },
  {
    "name": "Soft Rounded",
    "category": "Sans + Sans",
    "heading": "Varela Round",
    "body": "Nunito Sans",
    "mood": "soft, rounded, friendly, approachable, warm, gentle",
    "best_for": "Children's products, pet apps, friendly brands, wellness, soft UI",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@300;400;500;600;700&family=Varela+Round&display=swap');",
    "tailwind": "fontFamily: { heading: ['Varela Round', 'sans-serif'], body: ['Nunito Sans', 'sans-serif'] }"
  },
  {
    "name": "Premium Sans",
    "category": "Sans + Sans",
    "heading": "Satoshi",
    "body": "General Sans",
    "mood": "premium, modern, clean, sophisticated, versatile, balanced",
    "best_for": "Premium brands, modern agencies, SaaS, portfolios, startups",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&display=swap');",
    "tailwind": "fontFamily: { sans: ['DM Sans', 'sans-serif'] }"
  },
  {
    "name": "Vietnamese Friendly",
    "category": "Sans + Sans",
    "heading": "Be Vietnam Pro",
    "body": "Noto Sans",
    "mood": "vietnamese, international, readable, clean, multilingual, accessible",
    "best_for": "Vietnamese sites, multilingual apps, international products",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@300;400;500;600;700&family=Noto+Sans:wght@300;400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { sans: ['Be Vietnam Pro', 'Noto Sans', 'sans-serif'] }"
  },
  {
    "name": "Japanese Elegant",
    "category": "Serif + Sans",
    "heading": "Noto Serif JP",
    "body": "Noto Sans JP",
    "mood": "japanese, elegant, traditional, modern, multilingual, readable",
    "best_for": "Japanese sites, Japanese restaurants, cultural sites, anime/manga",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&family=Noto+Serif+JP:wght@400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { serif: ['Noto Serif JP', 'serif'], sans: ['Noto Sans JP', 'sans-serif'] }"
  },
  {
    "name": "Korean Modern",
    "category": "Sans + Sans",
    "heading": "Noto Sans KR",
    "body": "Noto Sans KR",
    "mood": "korean, modern, clean, professional, multilingual, readable",
    "best_for": "Korean sites, K-beauty, K-pop, Korean businesses, multilingual",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&display=swap');",
    "tailwind": "fontFamily: { sans: ['Noto Sans KR', 'sans-serif'] }"
  },
  {
    "name": "Chinese Traditional",
    "category": "Serif + Sans",
    "heading": "Noto Serif TC",
    "body": "Noto Sans TC",
    "mood": "chinese, traditional, elegant, cultural, multilingual, readable",
    "best_for": "Traditional Chinese sites, cultural content, Taiwan/Hong Kong markets",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;700&family=Noto+Serif+TC:wght@400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { serif: ['Noto Serif TC', 'serif'], sans: ['Noto Sans TC', 'sans-serif'] }"
  },
  {
    "name": "Chinese Simplified",
    "category": "Sans + Sans",
    "heading": "Noto Sans SC",
    "body": "Noto Sans SC",
    "mood": "chinese, simplified, modern, professional, multilingual, readable",
    "best_for": "Simplified Chinese sites, mainland China market, business apps",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700&display=swap');",
    "tailwind": "fontFamily: { sans: ['Noto Sans SC', 'sans-serif'] }"
  },
  {
    "name": "Arabic Elegant",
    "category": "Serif + Sans",
    "heading": "Noto Naskh Arabic",
    "body": "Noto Sans Arabic",
    "mood": "arabic, elegant, traditional, cultural, RTL, readable",
    "best_for": "Arabic sites, Middle East market, Islamic content, bilingual sites",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;500;600;700&family=Noto+Sans+Arabic:wght@300;400;500;700&display=swap');",
    "tailwind": "fontFamily: { serif: ['Noto Naskh Arabic', 'serif'], sans: ['Noto Sans Arabic', 'sans-serif'] }"
  },
  {
    "name": "Thai Modern",
    "category": "Sans + Sans",
    "heading": "Noto Sans Thai",
    "body": "Noto Sans Thai",
    "mood": "thai, modern, readable, clean, multilingual, accessible",
    "best_for": "Thai sites, Southeast Asia, tourism, Thai restaurants",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@300;400;500;700&display=swap');",
    "tailwind": "fontFamily: { sans: ['Noto Sans Thai', 'sans-serif'] }"
  },
  {
    "name": "Hebrew Modern",
    "category": "Sans + Sans",
    "heading": "Noto Sans Hebrew",
    "body": "Noto Sans Hebrew",
    "mood": "hebrew, modern, RTL, clean, professional, readable",
    "best_for": "Hebrew sites, Israeli market, Jewish content, bilingual sites",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Hebrew:wght@300;400;500;700&display=swap');",
    "tailwind": "fontFamily: { sans: ['Noto Sans Hebrew', 'sans-serif'] }"
  },
  {
    "name": "Legal Professional",
    "category": "Serif + Sans",
    "heading": "EB Garamond",
    "body": "Lato",
    "mood": "legal, professional, traditional, trustworthy, formal, authoritative",
    "best_for": "Law firms, legal services, contracts, formal documents, government",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500;600;700&family=Lato:wght@300;400;700&display=swap');",
    "tailwind": "fontFamily: { serif: ['EB Garamond', 'serif'], sans: ['Lato', 'sans-serif'] }"
  },
  {
    "name": "Medical Clean",
    "category": "Sans + Sans",
    "heading": "Figtree",
    "body": "Noto Sans",
    "mood": "medical, clean, accessible, professional, healthcare, trustworthy",
    "best_for": "Healthcare, medical clinics, pharma, health apps, accessibility",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Figtree:wght@300;400;500;600;700&family=Noto+Sans:wght@300;400;500;700&display=swap');",
    "tailwind": "fontFamily: { heading: ['Figtree', 'sans-serif'], body: ['Noto Sans', 'sans-serif'] }"
  },
  {
    "name": "Financial Trust",
    "category": "Sans + Sans",
    "heading": "IBM Plex Sans",
    "body": "IBM Plex Sans",
    "mood": "financial, trustworthy, professional, corporate, banking, serious",
    "best_for": "Banks, finance, insurance, investment, fintech, enterprise",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { sans: ['IBM Plex Sans', 'sans-serif'] }"
  },
  {
    "name": "Real Estate Luxury",
    "category": "Serif + Sans",
    "heading": "Cinzel",
    "body": "Josefin Sans",
    "mood": "real estate, luxury, elegant, sophisticated, property, premium",
    "best_for": "Real estate, luxury properties, architecture, interior design",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600;700&family=Josefin+Sans:wght@300;400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { serif: ['Cinzel', 'serif'], sans: ['Josefin Sans', 'sans-serif'] }"
  },
  {
    "name": "Restaurant Menu",
    "category": "Serif + Sans",
    "heading": "Playfair Display SC",
    "body": "Karla",
    "mood": "restaurant, menu, culinary, elegant, foodie, hospitality",
    "best_for": "Restaurants, cafes, food blogs, culinary, hospitality",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Karla:wght@300;400;500;600;700&family=Playfair+Display+SC:wght@400;700&display=swap');",
    "tailwind": "fontFamily: { display: ['Playfair Display SC', 'serif'], sans: ['Karla', 'sans-serif'] }"
  },
  {
    "name": "Art Deco",
    "category": "Display + Sans",
    "heading": "Poiret One",
    "body": "Didact Gothic",
    "mood": "art deco, vintage, 1920s, elegant, decorative, gatsby",
    "best_for": "Vintage events, art deco themes, luxury hotels, classic cocktails",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Didact+Gothic&family=Poiret+One&display=swap');",
    "tailwind": "fontFamily: { display: ['Poiret One', 'sans-serif'], sans: ['Didact Gothic', 'sans-serif'] }"
  },
  {
    "name": "Magazine Style",
    "category": "Serif + Sans",
    "heading": "Libre Bodoni",
    "body": "Public Sans",
    "mood": "magazine, editorial, publishing, refined, journalism, print",
    "best_for": "Magazines, online publications, editorial content, journalism",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Libre+Bodoni:wght@400;500;600;700&family=Public+Sans:wght@300;400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { serif: ['Libre Bodoni', 'serif'], sans: ['Public Sans', 'sans-serif'] }"
  },
  {
    "name": "Crypto/Web3",
    "category": "Sans + Sans",
    "heading": "Orbitron",
    "body": "Exo 2",
    "mood": "crypto, web3, futuristic, tech, blockchain, digital",
    "best_for": "Crypto platforms, NFT, blockchain, web3, futuristic tech",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Exo+2:wght@300;400;500;600;700&family=Orbitron:wght@400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { display: ['Orbitron', 'sans-serif'], body: ['Exo 2', 'sans-serif'] }"
  },
  {
    "name": "Gaming Bold",
    "category": "Display + Sans",
    "heading": "Russo One",
    "body": "Chakra Petch",
    "mood": "gaming, bold, action, esports, competitive, energetic",
    "best_for": "Gaming, esports, action games, competitive sports, entertainment",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@300;400;500;600;700&family=Russo+One&display=swap');",
    "tailwind": "fontFamily: { display: ['Russo One', 'sans-serif'], body: ['Chakra Petch', 'sans-serif'] }"
  },
  {
    "name": "Indie/Craft",
    "category": "Display + Sans",
    "heading": "Amatic SC",
    "body": "Cabin",
    "mood": "indie, craft, handmade, artisan, organic, creative",
    "best_for": "Craft brands, indie products, artisan, handmade, organic products",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Amatic+SC:wght@400;700&family=Cabin:wght@400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { display: ['Amatic SC', 'sans-serif'], sans: ['Cabin', 'sans-serif'] }"
  },
  {
    "name": "Startup Bold",
    "category": "Sans + Sans",
    "heading": "Clash Display",
    "body": "Satoshi",
    "mood": "startup, bold, modern, innovative, confident, dynamic",
    "best_for": "Startups, pitch decks, product launches, bold brands",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Rubik:wght@300;400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { heading: ['Outfit', 'sans-serif'], body: ['Rubik', 'sans-serif'] }"
  },
  {
    "name": "E-commerce Clean",
    "category": "Sans + Sans",
    "heading": "Rubik",
    "body": "Nunito Sans",
    "mood": "ecommerce, clean, shopping, product, retail, conversion",
    "best_for": "E-commerce, online stores, product pages, retail, shopping",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@300;400;500;600;700&family=Rubik:wght@300;400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { heading: ['Rubik', 'sans-serif'], body: ['Nunito Sans', 'sans-serif'] }"
  },
  {
    "name": "Academic/Research",
    "category": "Serif + Sans",
    "heading": "Crimson Pro",
    "body": "Atkinson Hyperlegible",
    "mood": "academic, research, scholarly, accessible, readable, educational",
    "best_for": "Universities, research papers, academic journals, educational",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Crimson+Pro:wght@400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { serif: ['Crimson Pro', 'serif'], sans: ['Atkinson Hyperlegible', 'sans-serif'] }"
  },
  {
    "name": "Dashboard Data",
    "category": "Mono + Sans",
    "heading": "Fira Code",
    "body": "Fira Sans",
    "mood": "dashboard, data, analytics, code, technical, precise",
    "best_for": "Dashboards, analytics, data visualization, admin panels",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&family=Fira+Sans:wght@300;400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { mono: ['Fira Code', 'monospace'], sans: ['Fira Sans', 'sans-serif'] }"
  },
  {
    "name": "Music/Entertainment",
    "category": "Display + Sans",
    "heading": "Righteous",
    "body": "Poppins",
    "mood": "music, entertainment, fun, energetic, bold, performance",
    "best_for": "Music platforms, entertainment, events, festivals, performers",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&family=Righteous&display=swap');",
    "tailwind": "fontFamily: { display: ['Righteous', 'sans-serif'], sans: ['Poppins', 'sans-serif'] }"
  },
  {
    "name": "Minimalist Portfolio",
    "category": "Sans + Sans",
    "heading": "Archivo",
    "body": "Space Grotesk",
    "mood": "minimal, portfolio, designer, creative, clean, artistic",
    "best_for": "Design portfolios, creative professionals, minimalist brands",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@300;400;500;600;700&family=Space+Grotesk:wght@300;400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { heading: ['Space Grotesk', 'sans-serif'], body: ['Archivo', 'sans-serif'] }"
  },
  {
    "name": "Kids/Education",
    "category": "Display + Sans",
    "heading": "Baloo 2",
    "body": "Comic Neue",
    "mood": "kids, education, playful, friendly, colorful, learning",
    "best_for": "Children's apps, educational games, kid-friendly content",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@400;500;600;700&family=Comic+Neue:wght@300;400;700&display=swap');",
    "tailwind": "fontFamily: { display: ['Baloo 2', 'sans-serif'], sans: ['Comic Neue', 'sans-serif'] }"
  },
  {
    "name": "Wedding/Romance",
    "category": "Script + Serif",
    "heading": "Great Vibes",
    "body": "Cormorant Infant",
    "mood": "wedding, romance, elegant, script, invitation, feminine",
    "best_for": "Wedding sites, invitations, romantic brands, bridal",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Cormorant+Infant:wght@300;400;500;600;700&family=Great+Vibes&display=swap');",
    "tailwind": "fontFamily: { script: ['Great Vibes', 'cursive'], serif: ['Cormorant Infant', 'serif'] }"
  },
  {
    "name": "Science/Tech",
    "category": "Sans + Sans",
    "heading": "Exo",
    "body": "Roboto Mono",
    "mood": "science, technology, research, data, futuristic, precise",
    "best_for": "Science, research, tech documentation, data-heavy sites",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Exo:wght@300;400;500;600;700&family=Roboto+Mono:wght@300;400;500;700&display=swap');",
    "tailwind": "fontFamily: { sans: ['Exo', 'sans-serif'], mono: ['Roboto Mono', 'monospace'] }"
  },
  {
    "name": "Accessibility First",
    "category": "Sans + Sans",
    "heading": "Atkinson Hyperlegible",
    "body": "Atkinson Hyperlegible",
    "mood": "accessible, readable, inclusive, WCAG, dyslexia-friendly, clear",
    "best_for": "Accessibility-critical sites, government, healthcare, inclusive design",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap');",
    "tailwind": "fontFamily: { sans: ['Atkinson Hyperlegible', 'sans-serif'] }"
  },
  {
    "name": "Sports/Fitness",
    "category": "Sans + Sans",
    "heading": "Barlow Condensed",
    "body": "Barlow",
    "mood": "sports, fitness, athletic, energetic, condensed, action",
    "best_for": "Sports, fitness, gyms, athletic brands, competition",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&family=Barlow:wght@300;400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { display: ['Barlow Condensed', 'sans-serif'], body: ['Barlow', 'sans-serif'] }"
  },
  {
    "name": "Luxury Minimalist",
    "category": "Serif + Sans",
    "heading": "Bodoni Moda",
    "body": "Jost",
    "mood": "luxury, minimalist, high-end, sophisticated, refined, premium",
    "best_for": "Luxury minimalist brands, high-end fashion, premium products",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Bodoni+Moda:wght@400;500;600;700&family=Jost:wght@300;400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { serif: ['Bodoni Moda', 'serif'], sans: ['Jost', 'sans-serif'] }"
  },
  {
    "name": "Tech/HUD Mono",
    "category": "Mono + Mono",
    "heading": "Share Tech Mono",
    "body": "Fira Code",
    "mood": "tech, futuristic, hud, sci-fi, data, monospaced, precise",
    "best_for": "Sci-fi interfaces, developer tools, cybersecurity, dashboards",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@300;400;500;600;700&family=Share+Tech+Mono&display=swap');",
    "tailwind": "fontFamily: { hud: ['Share Tech Mono', 'monospace'], code: ['Fira Code', 'monospace'] }"
  },
  {
    "name": "Pixel Retro",
    "category": "Display + Sans",
    "heading": "Press Start 2P",
    "body": "VT323",
    "mood": "pixel, retro, gaming, 8-bit, nostalgic, arcade",
    "best_for": "Pixel art games, retro websites, creative portfolios",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap');",
    "tailwind": "fontFamily: { pixel: ['Press Start 2P', 'cursive'], terminal: ['VT323', 'monospace'] }"
  },
  {
    "name": "Neubrutalist Bold",
    "category": "Display + Sans",
    "heading": "Lexend Mega",
    "body": "Public Sans",
    "mood": "bold, neubrutalist, loud, strong, geometric, quirky",
    "best_for": "Neubrutalist designs, Gen Z brands, bold marketing",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Lexend+Mega:wght@100..900&family=Public+Sans:wght@100..900&display=swap');",
    "tailwind": "fontFamily: { mega: ['Lexend Mega', 'sans-serif'], body: ['Public Sans', 'sans-serif'] }"
  },
  {
    "name": "Academic/Archival",
    "category": "Serif + Serif",
    "heading": "EB Garamond",
    "body": "Crimson Text",
    "mood": "academic, old-school, university, research, serious, traditional",
    "best_for": "University sites, archives, research papers, history",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Crimson+Text:wght@400;600;700&family=EB+Garamond:wght@400;500;600;700;800&display=swap');",
    "tailwind": "fontFamily: { classic: ['EB Garamond', 'serif'], text: ['Crimson Text', 'serif'] }"
  },
  {
    "name": "Spatial Clear",
    "category": "Sans + Sans",
    "heading": "Inter",
    "body": "Inter",
    "mood": "spatial, legible, glass, system, clean, neutral",
    "best_for": "Spatial computing, AR/VR, glassmorphism interfaces",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap');",
    "tailwind": "fontFamily: { sans: ['Inter', 'sans-serif'] }"
  },
  {
    "name": "Kinetic Motion",
    "category": "Display + Mono",
    "heading": "Syncopate",
    "body": "Space Mono",
    "mood": "kinetic, motion, futuristic, speed, wide, tech",
    "best_for": "Music festivals, automotive, high-energy brands",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syncopate:wght@400;700&display=swap');",
    "tailwind": "fontFamily: { display: ['Syncopate', 'sans-serif'], mono: ['Space Mono', 'monospace'] }"
  },
  {
    "name": "Gen Z Brutal",
    "category": "Display + Sans",
    "heading": "Anton",
    "body": "Epilogue",
    "mood": "brutal, loud, shouty, meme, internet, bold",
    "best_for": "Gen Z marketing, streetwear, viral campaigns",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Anton&family=Epilogue:wght@400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { display: ['Anton', 'sans-serif'], body: ['Epilogue', 'sans-serif'] }"
  },
  {
    "name": "Minimalist Monochrome Editorial",
    "category": "Serif + Serif + Mono (Triple Stack)",
    "heading": "Playfair Display",
    "body": "Source Serif 4",
    "mood": "monochrome, editorial, austere, typographic, pocket manifesto, luxury, high contrast, brutalist mobile",
    "best_for": "Luxury fashion mobile apps, editorial publications, digital exhibitions, portfolio apps, high-contrast e-reader aesthetics",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=Source+Serif+4:ital,wght@0,300;0,400;0,600;1,300&display=swap');",
    "tailwind": "fontFamily: { display: ['Playfair Display', 'serif'], body: ['Source Serif 4', 'serif'], mono: ['JetBrains Mono', 'monospace'] }"
  },
  {
    "name": "Modern Dark Cinema (Inter System)",
    "category": "Sans + Mono",
    "heading": "Inter",
    "body": "Inter",
    "mood": "dark, cinematic, technical, precision, clean, premium, developer, professional, high-end utility",
    "best_for": "Developer tools, fintech/trading, AI dashboards, streaming platforms, high-end productivity apps",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { sans: ['Inter', 'sans-serif'] }"
  },
  {
    "name": "SaaS Mobile Boutique (Calistoga + Inter)",
    "category": "Display Serif + Sans + Mono",
    "heading": "Calistoga",
    "body": "Inter",
    "mood": "saas, boutique, electric, warm, editorial, bold, premium, fintech, business, dual font, human warmth",
    "best_for": "B2B SaaS mobile, fintech apps, analytics dashboards, marketing tools, operations platforms",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Calistoga:ital@0;1&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');",
    "tailwind": "fontFamily: { display: ['Calistoga', 'serif'], body: ['Inter', 'sans-serif'], mono: ['JetBrains Mono', 'monospace'] }"
  },
  {
    "name": "Terminal CLI Monospace",
    "category": "Mono + Mono (Single Family)",
    "heading": "JetBrains Mono",
    "body": "JetBrains Mono",
    "mood": "terminal, cli, hacker, monospace, matrix, developer, retro-future, command line, precision, OLED",
    "best_for": "Developer tools, Web3/blockchain apps, hacker aesthetic, sci-fi games, ARG, security tools, geek-culture portfolios",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,500;1,400&display=swap');",
    "tailwind": "fontFamily: { mono: ['JetBrains Mono', 'monospace'] }"
  },
  {
    "name": "Kinetic Brutalism (Space Grotesk)",
    "category": "Geometric Sans (Single Dominant)",
    "heading": "Space Grotesk",
    "body": "Space Grotesk",
    "mood": "kinetic, brutalist, aggressive, uppercase, oversized, display, motion, street, bold, high-energy, zine",
    "best_for": "Music/culture apps, sports platforms, brand flagship mobile, performance dashboards, underground product drops",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap');",
    "tailwind": "fontFamily: { display: ['Space Grotesk', 'sans-serif'], body: ['Space Grotesk', 'sans-serif'] }"
  },
  {
    "name": "Flat Design Mobile (System Bold)",
    "category": "Sans + Sans",
    "heading": "Inter",
    "body": "Inter",
    "mood": "flat, clean, system, bold, geometric, cross-platform, icon, poster, minimal, functional, responsive",
    "best_for": "Cross-platform apps, dashboards, system UI, onboarding, marketing pages, informational apps, icon-heavy interfaces",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');",
    "tailwind": "fontFamily: { sans: ['Inter', 'sans-serif'] }"
  },
  {
    "name": "Material You MD3 (Roboto System)",
    "category": "Sans (System Default)",
    "heading": "Roboto",
    "body": "Roboto",
    "mood": "material design 3, md3, android, google, tonal, friendly, rounded, accessible, adaptive",
    "best_for": "Android apps, cross-platform tools, productivity software, data-heavy B2B dashboards, enterprise mobile",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,300;0,400;0,500;0,700;1,400&display=swap');",
    "tailwind": "fontFamily: { sans: ['Roboto', 'sans-serif'] }"
  },
  {
    "name": "Neo Brutalism Mobile (Space Grotesk Heavy)",
    "category": "Geometric Sans (Bold-Only)",
    "heading": "Space Grotesk",
    "body": "Space Grotesk",
    "mood": "neo brutalism, pop art, loud, bold, heavy, stickers, mechanical, high contrast, cream, gen-z",
    "best_for": "Creative tools, Gen-Z marketing, e-commerce for youth culture, content portfolios, collage-style apps",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&display=swap');",
    "tailwind": "fontFamily: { display: ['Space Grotesk', 'sans-serif'], body: ['Space Grotesk', 'sans-serif'] }"
  },
  {
    "name": "Bold Typography Mobile (Inter-Tight Poster)",
    "category": "Sans + Serif (Display) + Mono",
    "heading": "Inter",
    "body": "Playfair Display",
    "mood": "bold typography, editorial, poster, near-black, vermillion, luxury, type-as-hero, manifesto, high-contrast",
    "best_for": "Creative brand flagships, reading platforms, event apps, flash pages, luxury mobile experiences",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&family=JetBrains+Mono:wght@400&family=Playfair+Display:ital@1&display=swap');",
    "tailwind": "fontFamily: { display: ['Inter', 'sans-serif'], quote: ['Playfair Display', 'serif'], mono: ['JetBrains Mono', 'monospace'] }"
  },
  {
    "name": "Academia Mobile (Cormorant + Crimson + Cinzel)",
    "category": "Serif + Book Serif + Engraved (Triple Stack)",
    "heading": "Cormorant Garamond",
    "body": "Crimson Pro",
    "mood": "academia, library, mahogany, parchment, brass, scholarly, prestige, antique, victorian, leather",
    "best_for": "Knowledge management apps, scholarly reading tools, personal brand portfolios, RPG games, cultural community platforms",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600&family=Cormorant+Garamond:ital,wght@0,300;0,500;0,700;1,300;1,500&family=Crimson+Pro:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap');",
    "tailwind": "fontFamily: { heading: ['Cormorant Garamond', 'serif'], body: ['Crimson Pro', 'serif'], display: ['Cinzel', 'serif'] }"
  },
  {
    "name": "Cyberpunk Mobile (Orbitron + JetBrains Mono)",
    "category": "Tech Display + Mono",
    "heading": "Orbitron",
    "body": "JetBrains Mono",
    "mood": "cyberpunk, neon, glitch, hud, sci-fi, dark, matrix green, magenta, chamfered, tactical",
    "best_for": "Gaming companion apps, fintech/crypto, data visualization, dark brand apps, cyberpunk narrative games",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Orbitron:wght@700;900&display=swap');",
    "tailwind": "fontFamily: { heading: ['Orbitron', 'sans-serif'], body: ['JetBrains Mono', 'monospace'] }"
  },
  {
    "name": "Web3 Bitcoin DeFi (Space Grotesk + Inter + Mono)",
    "category": "Geometric Sans + Sans + Mono (Triple)",
    "heading": "Space Grotesk",
    "body": "Inter",
    "mood": "web3, bitcoin, defi, digital gold, fintech, crypto, trustless, luminescent, precision, dark",
    "best_for": "DeFi protocols and wallets, NFT platforms, metaverse social apps, high-tech brand landing pages",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@500;600;700&display=swap');",
    "tailwind": "fontFamily: { heading: ['Space Grotesk', 'sans-serif'], body: ['Inter', 'sans-serif'], mono: ['JetBrains Mono', 'monospace'] }"
  },
  {
    "name": "Claymorphism Mobile (Nunito + DM Sans)",
    "category": "Display Rounded + Geometric Sans",
    "heading": "Nunito",
    "body": "DM Sans",
    "mood": "claymorphism, clay, rounded, playful, candy, bubbly, soft, 3d, children, education, tactile, spring, nunito, dm sans",
    "best_for": "Children education apps, teen social, brand mascot apps, creative tools, fintech gamification",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,700;1,400&family=Nunito:ital,wght@0,700;0,800;0,900;1,700&display=swap');",
    "tailwind": "fontFamily: { display: ['Nunito', 'sans-serif'], body: ['DM Sans', 'sans-serif'] }"
  },
  {
    "name": "Enterprise SaaS Mobile (Plus Jakarta Sans)",
    "category": "Geometric Sans (Single Family)",
    "heading": "Plus Jakarta Sans",
    "body": "Plus Jakarta Sans",
    "mood": "enterprise, saas, b2b, professional, indigo, modern, approachable, legible, ios dynamic type, android scaling",
    "best_for": "B2B SaaS apps, productivity tools, government and finance mobile apps, admin dashboards, enterprise onboarding",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,400;0,600;0,700;0,800;1,400&display=swap');",
    "tailwind": "fontFamily: { sans: ['Plus Jakarta Sans', 'sans-serif'] }"
  },
  {
    "name": "Sketch Hand-Drawn Mobile (Kalam + Patrick Hand)",
    "category": "Handwritten + Handwritten (Dual)",
    "heading": "Kalam",
    "body": "Patrick Hand",
    "mood": "sketch, hand-drawn, handwriting, human, imperfect, organic, paper, kalam, patrick hand, education, journal, creative",
    "best_for": "Journaling apps, prototype tools, children's picturebook apps, creative platforms, gamified puzzle apps",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Kalam:wght@400;700&family=Patrick+Hand&display=swap');",
    "tailwind": "fontFamily: { heading: ['Kalam', 'cursive'], body: ['Patrick Hand', 'cursive'] }"
  },
  {
    "name": "Neumorphism Mobile (Plus Jakarta Sans + System)",
    "category": "Geometric Sans (System Fallback)",
    "heading": "Plus Jakarta Sans",
    "body": "Plus Jakarta Sans",
    "mood": "neumorphism, soft ui, monochromatic, cool grey, minimal, physical, depth, ceramic, system font, utility",
    "best_for": "Smart home controls, minimal tools, aesthetic dashboards, health monitors, brand showcase pages",
    "css_import": "@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,700;1,400&display=swap');",
    "tailwind": "fontFamily: { sans: ['Plus Jakarta Sans', 'sans-serif'] }"
  }
];

export const PRODUCT_TYPES: ProductType[] = [
  {
    "type": "SaaS (General)",
    "keywords": "app, b2b, cloud, general, saas, software, subscription",
    "style": "Glassmorphism + Flat Design",
    "pattern": "Hero + Features + CTA"
  },
  {
    "type": "Micro SaaS",
    "keywords": "app, b2b, cloud, indie, micro, micro-saas, niche, saas, small, software, solo, subscription",
    "style": "Flat Design + Vibrant & Block",
    "pattern": "Minimal & Direct + Demo"
  },
  {
    "type": "E-commerce",
    "keywords": "buy, commerce, e, ecommerce, products, retail, sell, shop, store",
    "style": "Vibrant & Block-based",
    "pattern": "Feature-Rich Showcase"
  },
  {
    "type": "E-commerce Luxury",
    "keywords": "buy, commerce, e, ecommerce, elegant, exclusive, high-end, luxury, premium, products, retail, sell, shop, store",
    "style": "Liquid Glass + Glassmorphism",
    "pattern": "Feature-Rich Showcase"
  },
  {
    "type": "B2B Service",
    "keywords": "appointment, b, b2b, booking, business, consultation, corporate, enterprise, service",
    "style": "Trust & Authority + Minimal",
    "pattern": "Feature-Rich Showcase"
  },
  {
    "type": "Financial Dashboard",
    "keywords": "admin, analytics, dashboard, data, financial, panel",
    "style": "Dark Mode (OLED) + Data-Dense",
    "pattern": "N/A - Dashboard focused"
  },
  {
    "type": "Analytics Dashboard",
    "keywords": "admin, analytics, dashboard, data, panel",
    "style": "Data-Dense + Heat Map & Heatmap",
    "pattern": "N/A - Analytics focused"
  },
  {
    "type": "Healthcare App",
    "keywords": "app, clinic, health, healthcare, medical, patient",
    "style": "Neumorphism + Accessible & Ethical",
    "pattern": "Social Proof-Focused"
  },
  {
    "type": "Educational App",
    "keywords": "app, course, education, educational, learning, school, training",
    "style": "Claymorphism + Micro-interactions",
    "pattern": "Storytelling-Driven"
  },
  {
    "type": "Creative Agency",
    "keywords": "agency, creative, design, marketing, studio",
    "style": "Brutalism + Motion-Driven",
    "pattern": "Storytelling-Driven"
  },
  {
    "type": "Portfolio/Personal",
    "keywords": "creative, personal, portfolio, projects, showcase, work",
    "style": "Motion-Driven + Minimalism",
    "pattern": "Storytelling-Driven"
  },
  {
    "type": "Gaming",
    "keywords": "entertainment, esports, game, gaming, play",
    "style": "3D & Hyperrealism + Retro-Futurism",
    "pattern": "Feature-Rich Showcase"
  },
  {
    "type": "Government/Public Service",
    "keywords": "appointment, booking, consultation, government, public, service",
    "style": "Accessible & Ethical + Minimalism",
    "pattern": "Minimal & Direct"
  },
  {
    "type": "Fintech/Crypto",
    "keywords": "banking, blockchain, crypto, defi, finance, fintech, money, nft, payment, web3",
    "style": "Glassmorphism + Dark Mode (OLED)",
    "pattern": "Conversion-Optimized"
  },
  {
    "type": "Social Media App",
    "keywords": "app, community, content, entertainment, media, network, sharing, social, streaming, users, video",
    "style": "Vibrant & Block-based + Motion-Driven",
    "pattern": "Feature-Rich Showcase"
  },
  {
    "type": "Productivity Tool",
    "keywords": "collaboration, productivity, project, task, tool, workflow",
    "style": "Flat Design + Micro-interactions",
    "pattern": "Interactive Product Demo"
  },
  {
    "type": "Design System/Component Library",
    "keywords": "component, design, library, system",
    "style": "Minimalism + Accessible & Ethical",
    "pattern": "Feature-Rich Showcase"
  },
  {
    "type": "AI/Chatbot Platform",
    "keywords": "ai, artificial-intelligence, automation, chatbot, machine-learning, ml, platform",
    "style": "AI-Native UI + Minimalism",
    "pattern": "Interactive Product Demo"
  },
  {
    "type": "NFT/Web3 Platform",
    "keywords": "nft, platform, web",
    "style": "Cyberpunk UI + Glassmorphism",
    "pattern": "Feature-Rich Showcase"
  },
  {
    "type": "Creator Economy Platform",
    "keywords": "creator, economy, platform",
    "style": "Vibrant & Block-based + Bento Box Grid",
    "pattern": "Social Proof-Focused"
  },
  {
    "type": "Remote Work/Collaboration Tool",
    "keywords": "collaboration, remote, tool, work",
    "style": "Soft UI Evolution + Minimalism",
    "pattern": "Feature-Rich Showcase"
  },
  {
    "type": "Mental Health App",
    "keywords": "app, health, mental",
    "style": "Neumorphism + Accessible & Ethical",
    "pattern": "Social Proof-Focused"
  },
  {
    "type": "Pet Tech App",
    "keywords": "app, pet, tech",
    "style": "Claymorphism + Vibrant & Block-based",
    "pattern": "Storytelling-Driven"
  },
  {
    "type": "Smart Home/IoT Dashboard",
    "keywords": "admin, analytics, dashboard, data, home, iot, panel, smart",
    "style": "Glassmorphism + Dark Mode (OLED)",
    "pattern": "Interactive Product Demo"
  },
  {
    "type": "EV/Charging Ecosystem",
    "keywords": "charging, ecosystem, ev",
    "style": "Minimalism + Aurora UI",
    "pattern": "Hero-Centric Design"
  },
  {
    "type": "Subscription Box Service",
    "keywords": "appointment, booking, box, consultation, membership, plan, recurring, service, subscription",
    "style": "Vibrant & Block-based + Motion-Driven",
    "pattern": "Feature-Rich Showcase"
  },
  {
    "type": "Podcast Platform",
    "keywords": "platform, podcast",
    "style": "Dark Mode (OLED) + Minimalism",
    "pattern": "Storytelling-Driven"
  },
  {
    "type": "Dating App",
    "keywords": "app, dating",
    "style": "Vibrant & Block-based + Motion-Driven",
    "pattern": "Social Proof-Focused"
  },
  {
    "type": "Micro-Credentials/Badges Platform",
    "keywords": "badges, credentials, micro, platform",
    "style": "Minimalism + Flat Design",
    "pattern": "Trust & Authority"
  },
  {
    "type": "Knowledge Base/Documentation",
    "keywords": "base, documentation, knowledge",
    "style": "Minimalism + Accessible & Ethical",
    "pattern": "FAQ/Documentation"
  },
  {
    "type": "Hyperlocal Services",
    "keywords": "appointment, booking, consultation, hyperlocal, service, services",
    "style": "Minimalism + Vibrant & Block-based",
    "pattern": "Conversion-Optimized"
  },
  {
    "type": "Beauty/Spa/Wellness Service",
    "keywords": "appointment, beauty, booking, consultation, service, spa, wellness",
    "style": "Soft UI Evolution + Neumorphism",
    "pattern": "Hero-Centric Design + Social Proof"
  },
  {
    "type": "Luxury/Premium Brand",
    "keywords": "brand, elegant, exclusive, high-end, luxury, premium",
    "style": "Liquid Glass + Glassmorphism",
    "pattern": "Storytelling-Driven + Feature-Rich"
  },
  {
    "type": "Restaurant/Food Service",
    "keywords": "appointment, booking, consultation, delivery, food, menu, order, restaurant, service",
    "style": "Vibrant & Block-based + Motion-Driven",
    "pattern": "Hero-Centric Design + Conversion"
  },
  {
    "type": "Fitness/Gym App",
    "keywords": "app, exercise, fitness, gym, health, workout",
    "style": "Vibrant & Block-based + Dark Mode (OLED)",
    "pattern": "Feature-Rich Showcase"
  },
  {
    "type": "Real Estate/Property",
    "keywords": "buy, estate, housing, property, real, real-estate, rent",
    "style": "Glassmorphism + Minimalism",
    "pattern": "Hero-Centric Design + Feature-Rich"
  },
  {
    "type": "Travel/Tourism Agency",
    "keywords": "agency, booking, creative, design, flight, hotel, marketing, studio, tourism, travel, vacation",
    "style": "Aurora UI + Motion-Driven",
    "pattern": "Storytelling-Driven + Hero-Centric"
  },
  {
    "type": "Hotel/Hospitality",
    "keywords": "hospitality, hotel",
    "style": "Liquid Glass + Minimalism",
    "pattern": "Hero-Centric Design + Social Proof"
  },
  {
    "type": "Wedding/Event Planning",
    "keywords": "conference, event, meetup, planning, registration, ticket, wedding",
    "style": "Soft UI Evolution + Aurora UI",
    "pattern": "Storytelling-Driven + Social Proof"
  },
  {
    "type": "Legal Services",
    "keywords": "appointment, attorney, booking, compliance, consultation, contract, law, legal, service, services",
    "style": "Trust & Authority + Minimalism",
    "pattern": "Trust & Authority + Minimal"
  },
  {
    "type": "Insurance Platform",
    "keywords": "insurance, platform",
    "style": "Trust & Authority + Flat Design",
    "pattern": "Conversion-Optimized + Trust"
  },
  {
    "type": "Banking/Traditional Finance",
    "keywords": "banking, finance, traditional",
    "style": "Minimalism + Accessible & Ethical",
    "pattern": "Trust & Authority + Feature-Rich"
  },
  {
    "type": "Online Course/E-learning",
    "keywords": "course, e, learning, online",
    "style": "Claymorphism + Vibrant & Block-based",
    "pattern": "Feature-Rich Showcase + Social Proof"
  },
  {
    "type": "Non-profit/Charity",
    "keywords": "charity, non, profit",
    "style": "Accessible & Ethical + Organic Biophilic",
    "pattern": "Storytelling-Driven + Trust"
  },
  {
    "type": "Music Streaming",
    "keywords": "music, streaming",
    "style": "Dark Mode (OLED) + Vibrant & Block-based",
    "pattern": "Feature-Rich Showcase"
  },
  {
    "type": "Video Streaming/OTT",
    "keywords": "ott, streaming, video",
    "style": "Dark Mode (OLED) + Motion-Driven",
    "pattern": "Hero-Centric Design + Feature-Rich"
  },
  {
    "type": "Job Board/Recruitment",
    "keywords": "board, job, recruitment",
    "style": "Flat Design + Minimalism",
    "pattern": "Conversion-Optimized + Feature-Rich"
  },
  {
    "type": "Marketplace (P2P)",
    "keywords": "buyers, listings, marketplace, p, platform, sellers",
    "style": "Vibrant & Block-based + Flat Design",
    "pattern": "Feature-Rich Showcase + Social Proof"
  },
  {
    "type": "Logistics/Delivery",
    "keywords": "delivery, logistics",
    "style": "Minimalism + Flat Design",
    "pattern": "Feature-Rich Showcase + Conversion"
  },
  {
    "type": "Agriculture/Farm Tech",
    "keywords": "agriculture, farm, tech",
    "style": "Organic Biophilic + Flat Design",
    "pattern": "Feature-Rich Showcase + Trust"
  },
  {
    "type": "Construction/Architecture",
    "keywords": "architecture, construction",
    "style": "Minimalism + 3D & Hyperrealism",
    "pattern": "Hero-Centric Design + Feature-Rich"
  },
  {
    "type": "Automotive/Car Dealership",
    "keywords": "automotive, car, dealership",
    "style": "Motion-Driven + 3D & Hyperrealism",
    "pattern": "Hero-Centric Design + Feature-Rich"
  },
  {
    "type": "Photography Studio",
    "keywords": "photography, studio",
    "style": "Motion-Driven + Minimalism",
    "pattern": "Storytelling-Driven + Hero-Centric"
  },
  {
    "type": "Coworking Space",
    "keywords": "coworking, space",
    "style": "Vibrant & Block-based + Glassmorphism",
    "pattern": "Hero-Centric Design + Feature-Rich"
  },
  {
    "type": "Home Services (Plumber/Electrician)",
    "keywords": "appointment, booking, consultation, electrician, home, plumber, service, services",
    "style": "Flat Design + Trust & Authority",
    "pattern": "Conversion-Optimized + Trust"
  },
  {
    "type": "Childcare/Daycare",
    "keywords": "childcare, daycare",
    "style": "Claymorphism + Vibrant & Block-based",
    "pattern": "Social Proof-Focused + Trust"
  },
  {
    "type": "Senior Care/Elderly",
    "keywords": "care, elderly, senior",
    "style": "Accessible & Ethical + Soft UI Evolution",
    "pattern": "Trust & Authority + Social Proof"
  },
  {
    "type": "Medical Clinic",
    "keywords": "clinic, medical",
    "style": "Accessible & Ethical + Minimalism",
    "pattern": "Trust & Authority + Conversion"
  },
  {
    "type": "Pharmacy/Drug Store",
    "keywords": "drug, pharmacy, store",
    "style": "Flat Design + Accessible & Ethical",
    "pattern": "Conversion-Optimized + Trust"
  },
  {
    "type": "Dental Practice",
    "keywords": "dental, practice",
    "style": "Soft UI Evolution + Minimalism",
    "pattern": "Social Proof-Focused + Conversion"
  },
  {
    "type": "Veterinary Clinic",
    "keywords": "clinic, veterinary",
    "style": "Claymorphism + Accessible & Ethical",
    "pattern": "Social Proof-Focused + Trust"
  },
  {
    "type": "Florist/Plant Shop",
    "keywords": "florist, plant, shop",
    "style": "Organic Biophilic + Vibrant & Block-based",
    "pattern": "Hero-Centric Design + Conversion"
  },
  {
    "type": "Bakery/Cafe",
    "keywords": "bakery, cafe",
    "style": "Vibrant & Block-based + Soft UI Evolution",
    "pattern": "Hero-Centric Design + Conversion"
  },
  {
    "type": "Brewery/Winery",
    "keywords": "brewery, winery",
    "style": "Motion-Driven + Storytelling-Driven",
    "pattern": "Storytelling-Driven + Hero-Centric"
  },
  {
    "type": "Airline",
    "keywords": "airline, aviation, flight, travel, booking, airport, flying",
    "style": "Minimalism + Glassmorphism",
    "pattern": "Conversion-Optimized + Feature-Rich"
  },
  {
    "type": "News/Media Platform",
    "keywords": "content, entertainment, media, news, platform, streaming, video",
    "style": "Minimalism + Flat Design",
    "pattern": "Hero-Centric Design + Feature-Rich"
  },
  {
    "type": "Magazine/Blog",
    "keywords": "articles, blog, content, magazine, posts, writing",
    "style": "Swiss Modernism 2.0 + Motion-Driven",
    "pattern": "Storytelling-Driven + Hero-Centric"
  },
  {
    "type": "Freelancer Platform",
    "keywords": "freelancer, platform",
    "style": "Flat Design + Minimalism",
    "pattern": "Feature-Rich Showcase + Conversion"
  },
  {
    "type": "Marketing Agency",
    "keywords": "agency, creative, design, marketing, studio",
    "style": "Brutalism + Motion-Driven",
    "pattern": "Storytelling-Driven + Feature-Rich"
  },
  {
    "type": "Event Management",
    "keywords": "conference, event, management, meetup, registration, ticket",
    "style": "Vibrant & Block-based + Motion-Driven",
    "pattern": "Hero-Centric Design + Feature-Rich"
  },
  {
    "type": "Membership/Community",
    "keywords": "community, membership",
    "style": "Vibrant & Block-based + Soft UI Evolution",
    "pattern": "Social Proof-Focused + Conversion"
  },
  {
    "type": "Newsletter Platform",
    "keywords": "newsletter, platform",
    "style": "Minimalism + Flat Design",
    "pattern": "Minimal & Direct + Conversion"
  },
  {
    "type": "Digital Products/Downloads",
    "keywords": "digital, downloads, products",
    "style": "Vibrant & Block-based + Motion-Driven",
    "pattern": "Feature-Rich Showcase + Conversion"
  },
  {
    "type": "Church/Religious Organization",
    "keywords": "church, organization, religious",
    "style": "Accessible & Ethical + Soft UI Evolution",
    "pattern": "Hero-Centric Design + Social Proof"
  },
  {
    "type": "Sports Team/Club",
    "keywords": "club, sports, team",
    "style": "Vibrant & Block-based + Motion-Driven",
    "pattern": "Hero-Centric Design + Feature-Rich"
  },
  {
    "type": "Museum/Gallery",
    "keywords": "gallery, museum",
    "style": "Minimalism + Motion-Driven",
    "pattern": "Storytelling-Driven + Feature-Rich"
  },
  {
    "type": "Theater/Cinema",
    "keywords": "cinema, theater",
    "style": "Dark Mode (OLED) + Motion-Driven",
    "pattern": "Hero-Centric Design + Conversion"
  },
  {
    "type": "Language Learning App",
    "keywords": "app, language, learning",
    "style": "Claymorphism + Vibrant & Block-based",
    "pattern": "Feature-Rich Showcase + Social Proof"
  },
  {
    "type": "Coding Bootcamp",
    "keywords": "bootcamp, coding",
    "style": "Dark Mode (OLED) + Minimalism",
    "pattern": "Feature-Rich Showcase + Social Proof"
  },
  {
    "type": "Cybersecurity Platform",
    "keywords": "cyber, security, platform",
    "style": "Cyberpunk UI + Dark Mode (OLED)",
    "pattern": "Trust & Authority + Real-Time"
  },
  {
    "type": "Developer Tool / IDE",
    "keywords": "dev, developer, tool, ide",
    "style": "Dark Mode (OLED) + Minimalism",
    "pattern": "Minimal & Direct + Documentation"
  },
  {
    "type": "Biotech / Life Sciences",
    "keywords": "biotech, biology, science",
    "style": "Glassmorphism + Clean Science",
    "pattern": "Storytelling-Driven + Research"
  },
  {
    "type": "Space Tech / Aerospace",
    "keywords": "aerospace, space, tech",
    "style": "Holographic / HUD + Dark Mode",
    "pattern": "Immersive Experience + Hero"
  },
  {
    "type": "Architecture / Interior",
    "keywords": "architecture, design, interior",
    "style": "Exaggerated Minimalism + High Imagery",
    "pattern": "Portfolio Grid + Visuals"
  },
  {
    "type": "Quantum Computing Interface",
    "keywords": "quantum, computing, physics, qubit, future, science",
    "style": "Holographic / HUD + Dark Mode",
    "pattern": "Immersive/Interactive Experience"
  },
  {
    "type": "Biohacking / Longevity App",
    "keywords": "biohacking, health, longevity, tracking, wellness, science",
    "style": "Biomimetic / Organic 2.0",
    "pattern": "Data-Dense + Storytelling"
  },
  {
    "type": "Autonomous Drone Fleet Manager",
    "keywords": "drone, autonomous, fleet, aerial, logistics, robotics",
    "style": "HUD / Sci-Fi FUI",
    "pattern": "Real-Time Monitor"
  },
  {
    "type": "Generative Art Platform",
    "keywords": "art, generative, ai, creative, platform, gallery",
    "style": "Minimalism (Frame) + Gen Z Chaos",
    "pattern": "Bento Grid Showcase"
  },
  {
    "type": "Spatial Computing OS / App",
    "keywords": "spatial, vr, ar, vision, os, immersive, mixed-reality",
    "style": "Spatial UI (VisionOS)",
    "pattern": "Immersive/Interactive Experience"
  },
  {
    "type": "Sustainable Energy / Climate Tech",
    "keywords": "climate, energy, sustainable, green, tech, carbon",
    "style": "Organic Biophilic + E-Ink / Paper",
    "pattern": "Interactive Demo + Data"
  },
  {
    "type": "Personal Finance Tracker",
    "keywords": "budget, expense, money, finance, spending, savings, tracker, personal, wallet",
    "style": "Glassmorphism + Dark Mode (OLED)",
    "pattern": "Interactive Product Demo"
  },
  {
    "type": "Chat & Messaging App",
    "keywords": "chat, message, messenger, im, realtime, conversation, inbox, dm, whatsapp, telegram",
    "style": "Minimalism + Micro-interactions",
    "pattern": "Feature-Rich Showcase + Demo"
  },
  {
    "type": "Notes & Writing App",
    "keywords": "notes, memo, writing, editor, notebook, markdown, journal, notion, obsidian",
    "style": "Minimalism + Flat Design",
    "pattern": "Minimal & Direct"
  },
  {
    "type": "Habit Tracker",
    "keywords": "habit, streak, routine, daily, tracker, goals, consistency, discipline",
    "style": "Claymorphism + Vibrant & Block-based",
    "pattern": "Social Proof-Focused + Demo"
  },
  {
    "type": "Food Delivery / On-Demand",
    "keywords": "delivery, food, order, uber-eats, doordash, takeout, on-demand, courier",
    "style": "Vibrant & Block-based + Motion-Driven",
    "pattern": "Hero-Centric Design + Feature-Rich"
  },
  {
    "type": "Ride Hailing / Transportation",
    "keywords": "ride, taxi, uber, lyft, transport, carpool, driver, trip, fare",
    "style": "Minimalism + Glassmorphism",
    "pattern": "Conversion-Optimized + Demo"
  },
  {
    "type": "Recipe & Cooking App",
    "keywords": "recipe, cooking, food, kitchen, cookbook, meal, ingredient, chef",
    "style": "Claymorphism + Vibrant & Block-based",
    "pattern": "Hero-Centric Design + Feature-Rich"
  },
  {
    "type": "Meditation & Mindfulness",
    "keywords": "meditation, mindfulness, calm, breathe, wellness, relaxation, sleep, headspace",
    "style": "Neumorphism + Soft UI Evolution",
    "pattern": "Storytelling-Driven + Social Proof"
  },
  {
    "type": "Weather App",
    "keywords": "weather, forecast, temperature, climate, rain, sun, location, humidity",
    "style": "Glassmorphism + Aurora UI",
    "pattern": "Hero-Centric Design"
  },
  {
    "type": "Diary & Journal App",
    "keywords": "diary, journal, personal, daily, reflection, mood, gratitude, writing",
    "style": "Soft UI Evolution + Minimalism",
    "pattern": "Storytelling-Driven"
  },
  {
    "type": "CRM & Client Management",
    "keywords": "crm, client, customer, sales, pipeline, contact, lead, deal, hubspot",
    "style": "Flat Design + Minimalism",
    "pattern": "Feature-Rich Showcase + Demo"
  },
  {
    "type": "Inventory & Stock Management",
    "keywords": "inventory, stock, warehouse, product, barcode, supply, sku, management",
    "style": "Flat Design + Minimalism",
    "pattern": "Feature-Rich Showcase"
  },
  {
    "type": "Flashcard & Study Tool",
    "keywords": "flashcard, quiz, study, spaced-repetition, anki, learn, memory, exam",
    "style": "Claymorphism + Micro-interactions",
    "pattern": "Feature-Rich Showcase + Demo"
  },
  {
    "type": "Booking & Appointment App",
    "keywords": "booking, appointment, schedule, calendar, reservation, slot, service",
    "style": "Soft UI Evolution + Flat Design",
    "pattern": "Conversion-Optimized"
  },
  {
    "type": "Invoice & Billing Tool",
    "keywords": "invoice, billing, payment, receipt, freelance, estimate, quote, accounting",
    "style": "Minimalism + Flat Design",
    "pattern": "Conversion-Optimized + Trust"
  },
  {
    "type": "Grocery & Shopping List",
    "keywords": "grocery, shopping, list, supermarket, checklist, pantry, meal-plan, buy",
    "style": "Flat Design + Vibrant & Block-based",
    "pattern": "Minimal & Direct + Demo"
  },
  {
    "type": "Timer & Pomodoro",
    "keywords": "timer, pomodoro, countdown, stopwatch, focus, clock, productivity, interval",
    "style": "Minimalism + Neumorphism",
    "pattern": "Minimal & Direct"
  },
  {
    "type": "Parenting & Baby Tracker",
    "keywords": "baby, parenting, child, feeding, sleep, diaper, milestone, family, newborn",
    "style": "Claymorphism + Soft UI Evolution",
    "pattern": "Social Proof-Focused + Trust"
  },
  {
    "type": "Scanner & Document Manager",
    "keywords": "scanner, document, ocr, pdf, scan, camera, file, archive, digitize",
    "style": "Minimalism + Flat Design",
    "pattern": "Feature-Rich Showcase + Demo"
  },
  {
    "type": "Calendar & Scheduling App",
    "keywords": "calendar, scheduling, planner, agenda, events, reminder, appointment, organize, date, sync",
    "style": "Flat Design + Micro-interactions",
    "pattern": "Feature-Rich Showcase + Demo"
  },
  {
    "type": "Password Manager",
    "keywords": "password, security, vault, credentials, login, secure, encrypt, keychain, 2fa, biometric",
    "style": "Minimalism + Accessible & Ethical",
    "pattern": "Trust & Authority + Feature-Rich"
  },
  {
    "type": "Expense Splitter / Bill Split",
    "keywords": "split, expense, bill, aa, share, friends, group, settle, debt, payment, owe",
    "style": "Flat Design + Vibrant & Block-based",
    "pattern": "Minimal & Direct + Demo"
  },
  {
    "type": "Voice Recorder & Memo",
    "keywords": "voice, recorder, memo, audio, transcription, dictate, recording, microphone, note, otter",
    "style": "Minimalism + AI-Native UI",
    "pattern": "Interactive Product Demo + Minimal"
  },
  {
    "type": "Bookmark & Read-Later",
    "keywords": "bookmark, read-later, save, article, pocket, link, reading, archive, collection, raindrop",
    "style": "Minimalism + Flat Design",
    "pattern": "Minimal & Direct + Demo"
  },
  {
    "type": "Translator App",
    "keywords": "translate, language, text, voice, ocr, dictionary, multilingual, real-time, detect, deepl",
    "style": "Flat Design + AI-Native UI",
    "pattern": "Feature-Rich Showcase + Interactive Demo"
  },
  {
    "type": "Calculator & Unit Converter",
    "keywords": "calculator, converter, unit, math, currency, measurement, scientific, formula, percentage",
    "style": "Neumorphism + Minimalism",
    "pattern": "Minimal & Direct"
  },
  {
    "type": "Alarm & World Clock",
    "keywords": "alarm, clock, world, timezone, timer, wake, sleep, schedule, reminder, bedtime",
    "style": "Dark Mode (OLED) + Minimalism",
    "pattern": "Minimal & Direct"
  },
  {
    "type": "File Manager & Transfer",
    "keywords": "file, manager, transfer, folder, document, storage, cloud, share, organize, compress",
    "style": "Flat Design + Minimalism",
    "pattern": "Feature-Rich Showcase + Demo"
  },
  {
    "type": "Email Client",
    "keywords": "email, mail, inbox, compose, thread, newsletter, filter, reply, gmail, spark, superhuman",
    "style": "Flat Design + Minimalism",
    "pattern": "Feature-Rich Showcase + Demo"
  },
  {
    "type": "Casual Puzzle Game",
    "keywords": "puzzle, casual, match, brain, game, relaxing, level, tiles, logic, block, three",
    "style": "Claymorphism + Vibrant & Block-based",
    "pattern": "Feature-Rich Showcase + Social Proof"
  },
  {
    "type": "Trivia & Quiz Game",
    "keywords": "trivia, quiz, knowledge, question, answer, challenge, leaderboard, fact, brain, compete",
    "style": "Vibrant & Block-based + Micro-interactions",
    "pattern": "Feature-Rich Showcase + Social Proof"
  },
  {
    "type": "Card & Board Game",
    "keywords": "card, board, chess, checkers, poker, strategy, turn-based, multiplayer, classic, tabletop",
    "style": "3D & Hyperrealism + Flat Design",
    "pattern": "Feature-Rich Showcase"
  },
  {
    "type": "Idle & Clicker Game",
    "keywords": "idle, clicker, incremental, passive, cookie, adventure, progress, offline, collect, prestige",
    "style": "Vibrant & Block-based + Motion-Driven",
    "pattern": "Feature-Rich Showcase"
  },
  {
    "type": "Word & Crossword Game",
    "keywords": "word, crossword, wordle, spelling, vocabulary, letters, grid, puzzle, dictionary, daily",
    "style": "Minimalism + Flat Design",
    "pattern": "Minimal & Direct + Demo"
  },
  {
    "type": "Arcade & Retro Game",
    "keywords": "arcade, retro, 8bit, action, shoot, runner, tap, reflex, endless, pixel, classic, score",
    "style": "Pixel Art + Retro-Futurism",
    "pattern": "Feature-Rich Showcase + Hero-Centric"
  },
  {
    "type": "Photo Editor & Filters",
    "keywords": "photo, edit, filter, vsco, snapseed, enhance, crop, retouch, adjust, luts, preset, adjust",
    "style": "Minimalism + Dark Mode (OLED)",
    "pattern": "Feature-Rich Showcase + Interactive Demo"
  },
  {
    "type": "Short Video Editor",
    "keywords": "video, edit, capcut, inshot, clip, reel, tiktok, trim, effects, transitions, music, timeline",
    "style": "Dark Mode (OLED) + Motion-Driven",
    "pattern": "Feature-Rich Showcase + Hero-Centric"
  },
  {
    "type": "Drawing & Sketching Canvas",
    "keywords": "drawing, sketch, procreate, canvas, paint, illustration, digital, brush, layers, art, stylus",
    "style": "Minimalism + Dark Mode (OLED)",
    "pattern": "Interactive Product Demo + Storytelling"
  },
  {
    "type": "Music Creation & Beat Maker",
    "keywords": "music, beat, daw, garageband, create, loop, sample, instrument, track, compose, record, midi",
    "style": "Dark Mode (OLED) + Motion-Driven",
    "pattern": "Interactive Product Demo + Storytelling"
  },
  {
    "type": "Meme & Sticker Maker",
    "keywords": "meme, sticker, maker, funny, caption, template, edit, share, viral, emoji, creator, reaction",
    "style": "Vibrant & Block-based + Flat Design",
    "pattern": "Feature-Rich Showcase + Social Proof"
  },
  {
    "type": "AI Photo & Avatar Generator",
    "keywords": "ai, photo, avatar, lensa, portrait, generate, selfie, style, filter, prisma, art",
    "style": "AI-Native UI + Aurora UI",
    "pattern": "Feature-Rich Showcase + Social Proof"
  },
  {
    "type": "Link-in-Bio Page Builder",
    "keywords": "bio, link, linktree, personal, page, creator, social, portfolio, profile, landing, custom",
    "style": "Vibrant & Block-based + Bento Box Grid",
    "pattern": "Conversion-Optimized + Social Proof"
  },
  {
    "type": "Wardrobe & Outfit Planner",
    "keywords": "wardrobe, outfit, fashion, clothes, closet, style, wear, plan, capsule, ootd, lookbook",
    "style": "Minimalism + Motion-Driven",
    "pattern": "Storytelling-Driven + Feature-Rich"
  },
  {
    "type": "Plant Care Tracker",
    "keywords": "plant, care, water, garden, tracker, reminder, species, photo, grow, health, planta",
    "style": "Organic Biophilic + Soft UI Evolution",
    "pattern": "Storytelling-Driven + Social Proof"
  },
  {
    "type": "Book & Reading Tracker",
    "keywords": "book, reading, tracker, goodreads, library, shelf, progress, review, notes, goal, literature",
    "style": "Swiss Modernism 2.0 + Minimalism",
    "pattern": "Social Proof-Focused + Feature-Rich"
  },
  {
    "type": "Couple & Relationship App",
    "keywords": "couple, relationship, partner, love, date, anniversary, memory, shared, intimate, between",
    "style": "Aurora UI + Soft UI Evolution",
    "pattern": "Storytelling-Driven + Social Proof"
  },
  {
    "type": "Family Calendar & Chores",
    "keywords": "family, calendar, chores, tasks, household, shared, kids, schedule, cozi, organize, member",
    "style": "Flat Design + Claymorphism",
    "pattern": "Feature-Rich Showcase + Social Proof"
  },
  {
    "type": "Mood Tracker",
    "keywords": "mood, emotion, feeling, mental, daily, journal, wellbeing, check-in, log, track, daylio",
    "style": "Soft UI Evolution + Minimalism",
    "pattern": "Storytelling-Driven + Social Proof"
  },
  {
    "type": "Gift & Wishlist",
    "keywords": "gift, wishlist, present, birthday, occasion, registry, idea, shop, list, share, surprise",
    "style": "Vibrant & Block-based + Soft UI Evolution",
    "pattern": "Minimal & Direct + Conversion"
  },
  {
    "type": "Running & Cycling GPS",
    "keywords": "running, cycling, gps, strava, track, route, speed, distance, cadence, pace, workout, sport",
    "style": "Dark Mode (OLED) + Vibrant & Block-based",
    "pattern": "Feature-Rich Showcase + Social Proof"
  },
  {
    "type": "Yoga & Stretching Guide",
    "keywords": "yoga, stretch, flexibility, pose, asana, guided, session, calm, routine, wellness, down-dog",
    "style": "Organic Biophilic + Soft UI Evolution",
    "pattern": "Storytelling-Driven + Social Proof"
  },
  {
    "type": "Sleep Tracker",
    "keywords": "sleep, tracker, alarm, cycle, quality, snore, analysis, rem, deep, smart, wake, insomnia",
    "style": "Dark Mode (OLED) + Neumorphism",
    "pattern": "Feature-Rich Showcase + Social Proof"
  },
  {
    "type": "Calorie & Nutrition Counter",
    "keywords": "calorie, nutrition, food, diet, macro, protein, carb, fat, log, fitness, myfitnesspal",
    "style": "Flat Design + Vibrant & Block-based",
    "pattern": "Feature-Rich Showcase + Social Proof"
  },
  {
    "type": "Period & Cycle Tracker",
    "keywords": "period, cycle, menstrual, fertility, ovulation, pms, log, women, health, flo, clue, hormone",
    "style": "Soft UI Evolution + Aurora UI",
    "pattern": "Social Proof-Focused + Trust"
  },
  {
    "type": "Medication & Pill Reminder",
    "keywords": "medication, pill, reminder, dose, schedule, prescription, drug, health, medisafe, refill",
    "style": "Accessible & Ethical + Flat Design",
    "pattern": "Trust & Authority + Feature-Rich"
  },
  {
    "type": "Water & Hydration Reminder",
    "keywords": "water, hydration, drink, reminder, daily, tracker, glasses, intake, health, cup, aqua",
    "style": "Claymorphism + Vibrant & Block-based",
    "pattern": "Minimal & Direct + Demo"
  },
  {
    "type": "Fasting & Intermittent Timer",
    "keywords": "fasting, intermittent, 16:8, timer, fast, eating, window, keto, diet, zero, weight, protocol",
    "style": "Minimalism + Dark Mode (OLED)",
    "pattern": "Feature-Rich Showcase + Social Proof"
  },
  {
    "type": "Anonymous Community / Confession",
    "keywords": "anonymous, community, confess, whisper, secret, vent, share, safe, private, social, yikyak",
    "style": "Dark Mode (OLED) + Minimalism",
    "pattern": "Social Proof-Focused + Feature-Rich"
  },
  {
    "type": "Local Events & Discovery",
    "keywords": "local, events, discovery, meetup, nearby, social, city, activities, calendar, community, explore",
    "style": "Vibrant & Block-based + Motion-Driven",
    "pattern": "Hero-Centric Design + Feature-Rich"
  },
  {
    "type": "Study Together / Virtual Coworking",
    "keywords": "study, focus, cowork, pomodoro, virtual, together, session, accountability, live, stream, room",
    "style": "Minimalism + Soft UI Evolution",
    "pattern": "Social Proof-Focused + Feature-Rich"
  },
  {
    "type": "Coding Challenge & Practice",
    "keywords": "coding, leetcode, challenge, algorithm, practice, programming, competitive, skill, interview, problem",
    "style": "Dark Mode (OLED) + Cyberpunk UI",
    "pattern": "Feature-Rich Showcase + Social Proof"
  },
  {
    "type": "Kids Learning (ABC & Math)",
    "keywords": "kids, children, learning, abc, math, phonics, numbers, education, games, preschool, early",
    "style": "Claymorphism + Vibrant & Block-based",
    "pattern": "Social Proof-Focused + Trust"
  },
  {
    "type": "Music Instrument Learning",
    "keywords": "music, instrument, piano, guitar, learn, lesson, tutorial, notes, play, chord, practice, simply",
    "style": "Vibrant & Block-based + Motion-Driven",
    "pattern": "Interactive Product Demo + Social Proof"
  },
  {
    "type": "Parking Finder",
    "keywords": "parking, spot, finder, map, pay, meter, garage, location, car, reserve, spothero",
    "style": "Minimalism + Glassmorphism",
    "pattern": "Conversion-Optimized + Feature-Rich"
  },
  {
    "type": "Public Transit Guide",
    "keywords": "transit, bus, metro, subway, train, route, schedule, map, city, commute, trip, citymapper",
    "style": "Flat Design + Accessible & Ethical",
    "pattern": "Feature-Rich Showcase + Interactive Demo"
  },
  {
    "type": "Road Trip Planner",
    "keywords": "road, trip, drive, route, planner, travel, stop, map, adventure, scenic, car, wanderlog",
    "style": "Aurora UI + Organic Biophilic",
    "pattern": "Storytelling-Driven + Hero-Centric"
  },
  {
    "type": "VPN & Privacy Tool",
    "keywords": "vpn, privacy, secure, anonymous, encrypt, proxy, ip, protect, shield, network, nordvpn",
    "style": "Minimalism + Dark Mode (OLED)",
    "pattern": "Trust & Authority + Conversion-Optimized"
  },
  {
    "type": "Emergency SOS & Safety",
    "keywords": "emergency, sos, safety, alert, location, help, danger, crisis, first-aid, guard, bsafe",
    "style": "Accessible & Ethical + Flat Design",
    "pattern": "Trust & Authority + Social Proof"
  },
  {
    "type": "Wallpaper & Theme App",
    "keywords": "wallpaper, theme, background, customize, aesthetic, home-screen, lock-screen, widget, design, zedge",
    "style": "Vibrant & Block-based + Aurora UI",
    "pattern": "Feature-Rich Showcase + Social Proof"
  },
  {
    "type": "White Noise & Ambient Sound",
    "keywords": "white noise, ambient, sound, sleep, focus, rain, nature, relax, concentration, background, noisli",
    "style": "Minimalism + Dark Mode (OLED)",
    "pattern": "Minimal & Direct + Social Proof"
  },
  {
    "type": "Home Decoration & Interior Design",
    "keywords": "home, interior, decor, design, furniture, room, renovation, ar, plan, inspire, 3d, houzz",
    "style": "Minimalism + 3D Product Preview",
    "pattern": "Storytelling-Driven + Feature-Rich"
  }
];
