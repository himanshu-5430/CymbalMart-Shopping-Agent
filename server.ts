import express, { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '5mb' }));

// Lazy initialization of Gemini client
let genAIClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI {
  if (!genAIClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('GEMINI_API_KEY is not set. Mock/fallback generation will be used.');
    }
    genAIClient = new GoogleGenAI({ apiKey: apiKey || '' });
  }
  return genAIClient;
}

const SYSTEM_PROMPT = `You are the CymbalMart AI Party Planner Shopping Agent.
Your role is to act as an expert event planner and smart grocery shopping assistant for CymbalMart customers.
Given the host's event details (party type, theme, budget, guest count: adults and kids, duration, dietary restrictions, special requests), you generate a comprehensive, realistic, and budget-conscious shopping list with items available at CymbalMart.

Key Rules:
1. Ensure items are categorized accurately into:
   - "mains": Main dishes, proteins, grills, pizzas
   - "appetizers": Finger foods, chips, dips, charcuterie, skewers
   - "beverages": Sodas, juices, mixers, craft beers, wine, mocktails, ice, water
   - "bakery": Cakes, cupcakes, cookies, sweet treats
   - "tableware": Plates, napkins, cups, utensils, tablecloths, trash bags
   - "decor": Balloons, banners, theme items, candles, lighting
   - "essentials": Ice bags, toothpicks, foil, condiments, wet wipes
2. Calculate quantities realistically based on guest count and duration:
   - Appetizers: 4-6 bites per guest for 2-3 hr party, 7-9 for longer
   - Drinks: 2-3 drinks per adult in first 2 hours, 1 per hour after; juices/sodas for kids
   - Ice: 1.5 lbs of ice per guest
   - Tableware: 1.5x - 2x guest count for plates/cups
3. Align pricing to CymbalMart store prices. Always provide:
   - CymbalMart Signature / Everyday Value options where cost-saving is beneficial
   - Specific package sizes (e.g. "12-pack", "24 oz tub", "50-count pack")
   - Unit price and recommended quantity
   - Whether the item is "must_have" or "optional"
4. Keep the total estimated cost as close to the host's target budget as possible without under-supplying food/drinks.
5. Provide a helpful host summary, party planning tips, and run-of-show timeline suggestions.

Always output VALID JSON matching this schema:
{
  "eventName": "string",
  "themeVibe": "string",
  "totalEstimatedCost": number,
  "budgetVariance": number, // positive if under budget, negative if over budget
  "costPerGuest": number,
  "summaryNotes": "string",
  "portionAnalysis": {
    "adultServings": number,
    "kidServings": number,
    "estimatedDrinksCount": number,
    "iceRequirementLbs": number,
    "notes": "string"
  },
  "items": [
    {
      "id": "string",
      "name": "string",
      "brand": "string", // e.g. "CymbalMart Signature", "CymbalMart Fresh", "Name Brand"
      "category": "mains" | "appetizers" | "beverages" | "bakery" | "tableware" | "decor" | "essentials",
      "unitSize": "string", // e.g. "32 oz bag", "12 pk cans", "50 ct pack"
      "unitPrice": number,
      "quantity": number,
      "tier": "signature" | "fresh" | "premium" | "value",
      "isMustHave": boolean,
      "dietaryTags": ["Vegan", "Gluten-Free", "Nut-Free", "Kid-Friendly", "Non-Alcoholic", etc.],
      "alternativeOption": {
        "name": "string",
        "brand": "string",
        "unitPrice": number,
        "savingsOrUpgrade": "string"
      }
    }
  ],
  "partyPrepTips": [
    {
      "timeframe": "2 Days Before" | "Day Before" | "2 Hours Before" | "During Party",
      "task": "string"
    }
  ]
}
`;

// Helper fallback generator if API key is not available or errors
function getFallbackPlan(reqBody: any) {
  const { partyType = 'Party', guestCount = { adults: 10, kids: 4 }, budget = 150, theme = 'Casual Gathering' } = reqBody;
  const totalGuests = (guestCount.adults || 0) + (guestCount.kids || 0) || 12;
  const budgetNum = Number(budget) || 150;

  return {
    eventName: reqBody.eventName || `${partyType} Celebration`,
    themeVibe: theme || 'Fun & Budget-Conscious',
    totalEstimatedCost: Math.min(budgetNum * 0.92, budgetNum),
    budgetVariance: budgetNum - (budgetNum * 0.92),
    costPerGuest: +( (budgetNum * 0.92) / totalGuests ).toFixed(2),
    summaryNotes: `A curated CymbalMart shopping plan tailored for ${totalGuests} guests with balanced portions, delicious signature staples, and full tableware coverage.`,
    portionAnalysis: {
      adultServings: guestCount.adults || 10,
      kidServings: guestCount.kids || 4,
      estimatedDrinksCount: totalGuests * 3,
      iceRequirementLbs: Math.max(10, Math.round(totalGuests * 1.5)),
      notes: "Calculated for average 3-hour event with generous appetizer portions and drink counts."
    },
    items: [
      {
        id: 'item-1',
        name: 'CymbalMart Artisan Angus Beef Patties & Buns Kit',
        brand: 'CymbalMart Fresh',
        category: 'mains',
        unitSize: '12 ct patties + buns',
        unitPrice: 18.99,
        quantity: Math.max(1, Math.ceil(totalGuests / 8)),
        tier: 'fresh',
        isMustHave: true,
        dietaryTags: ['High-Protein'],
        alternativeOption: {
          name: 'Plant-Based Veggie Burger Patties',
          brand: 'CymbalMart Green',
          unitPrice: 14.99,
          savingsOrUpgrade: 'Save $4.00 for vegetarian option'
        }
      },
      {
        id: 'item-2',
        name: 'CymbalMart Signature Mild Cheddar Slices',
        brand: 'CymbalMart Signature',
        category: 'mains',
        unitSize: '24 slices (16 oz)',
        unitPrice: 4.49,
        quantity: 1,
        tier: 'signature',
        isMustHave: true,
        dietaryTags: ['Gluten-Free'],
        alternativeOption: {
          name: 'Tillamook Sharp Cheddar Slices',
          brand: 'Tillamook',
          unitPrice: 6.29,
          savingsOrUpgrade: 'Premium aged cheese option'
        }
      },
      {
        id: 'item-3',
        name: 'Crispy Tortilla Chips & Chunky Salsa Duo',
        brand: 'CymbalMart Signature',
        category: 'appetizers',
        unitSize: '18 oz Party Bag + 24 oz Jar',
        unitPrice: 6.99,
        quantity: 2,
        tier: 'signature',
        isMustHave: true,
        dietaryTags: ['Vegan', 'Gluten-Free'],
        alternativeOption: {
          name: 'Organic Lime Sea Salt Tortilla Chips',
          brand: 'Late July',
          unitPrice: 8.49,
          savingsOrUpgrade: 'Organic non-GMO alternative'
        }
      },
      {
        id: 'item-4',
        name: 'Fresh Guacamole & Crudité Veggie Platter with Ranch',
        brand: 'CymbalMart Fresh Deli',
        category: 'appetizers',
        unitSize: '32 oz Party Platter',
        unitPrice: 13.99,
        quantity: 1,
        tier: 'fresh',
        isMustHave: false,
        dietaryTags: ['Vegetarian', 'Gluten-Free'],
        alternativeOption: {
          name: 'DIY Whole Veggies & Dip Pack',
          brand: 'CymbalMart Value',
          unitPrice: 8.99,
          savingsOrUpgrade: 'Save $5.00 by slicing yourself'
        }
      },
      {
        id: 'item-5',
        name: 'CymbalMart Sparkling Soda & Seltzer Variety Pack',
        brand: 'CymbalMart Signature',
        category: 'beverages',
        unitSize: '24 pk (12 fl oz cans)',
        unitPrice: 9.99,
        quantity: 2,
        tier: 'signature',
        isMustHave: true,
        dietaryTags: ['Non-Alcoholic', 'Zero Sugar Options'],
        alternativeOption: {
          name: 'LaCroix Sparkling Water 24pk',
          brand: 'LaCroix',
          unitPrice: 12.49,
          savingsOrUpgrade: 'Name-brand flavored seltzers'
        }
      },
      {
        id: 'item-6',
        name: 'Freshly Baked Celebration Cupcake Assortment',
        brand: 'CymbalMart Bakery',
        category: 'bakery',
        unitSize: '12 ct Vanilla & Chocolate',
        unitPrice: 11.99,
        quantity: Math.max(1, Math.ceil(totalGuests / 10)),
        tier: 'fresh',
        isMustHave: true,
        dietaryTags: ['Vegetarian', 'Kid-Friendly'],
        alternativeOption: {
          name: 'Gluten-Free Brownie Bites Box',
          brand: 'CymbalMart Bakery',
          unitPrice: 9.99,
          savingsOrUpgrade: 'Gluten-free allergen friendly'
        }
      },
      {
        id: 'item-7',
        name: 'Heavy Duty Compostable Plates & Cutlery Kit',
        brand: 'CymbalMart EcoHome',
        category: 'tableware',
        unitSize: '50 ct Plates + 50 ct Utensil sets',
        unitPrice: 8.99,
        quantity: 1,
        tier: 'signature',
        isMustHave: true,
        dietaryTags: ['Eco-Friendly'],
        alternativeOption: {
          name: 'Everyday Paper Plates 100ct',
          brand: 'CymbalMart Value',
          unitPrice: 5.99,
          savingsOrUpgrade: 'Save $3.00 with standard paper'
        }
      },
      {
        id: 'item-8',
        name: 'Party Theme Balloon Garland & Banner Set',
        brand: 'CymbalMart Celebrations',
        category: 'decor',
        unitSize: '35 pc Kit with Pump',
        unitPrice: 12.99,
        quantity: 1,
        tier: 'value',
        isMustHave: false,
        dietaryTags: [],
        alternativeOption: {
          name: 'Table Confetti & Centerpiece Pack',
          brand: 'CymbalMart Value',
          unitPrice: 6.49,
          savingsOrUpgrade: 'Minimalist low-cost decor'
        }
      },
      {
        id: 'item-9',
        name: 'Pure Filtered Cocktail Ice Bag',
        brand: 'CymbalMart Signature',
        category: 'essentials',
        unitSize: '10 lbs Bag',
        unitPrice: 2.99,
        quantity: Math.max(1, Math.ceil(totalGuests * 1.5 / 10)),
        tier: 'signature',
        isMustHave: true,
        dietaryTags: [],
        alternativeOption: {
          name: 'Double Pack 20 lbs Ice',
          brand: 'CymbalMart Value',
          unitPrice: 4.99,
          savingsOrUpgrade: 'Save $1.00 on bulk ice'
        }
      }
    ],
    partyPrepTips: [
      {
        timeframe: '2 Days Before',
        task: 'Confirm final RSVP count and reserve CymbalMart curbside pickup time window.'
      },
      {
        timeframe: 'Day Before',
        task: 'Pick up dry goods, tableware, and decor. Assemble balloon garland and chill beverages.'
      },
      {
        timeframe: '2 Hours Before',
        task: 'Pick up fresh perishables & hot items, fill ice buckets, slice burger toppings and arrange snack platters.'
      },
      {
        timeframe: 'During Party',
        task: 'Replenish chips and dips at the 90-minute mark; bring out dessert 45 minutes before wrap-up.'
      }
    ]
  };
}

// POST /api/plan-event
app.post('/api/plan-event', async (req: Request, res: Response) => {
  try {
    const {
      eventName,
      partyType,
      theme,
      budget,
      guestCount,
      durationHours,
      dietaryRestrictions,
      budgetTierPreference,
      specialRequests
    } = req.body;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.log('No GEMINI_API_KEY found, returning curated fallback plan.');
      return res.json(getFallbackPlan(req.body));
    }

    const ai = getGenAI();
    const prompt = `
Create a comprehensive CymbalMart shopping plan for this event:
- Event Name: ${eventName || 'CymbalMart Party'}
- Party Type: ${partyType || 'Celebration'}
- Theme / Vibe: ${theme || 'Casual & Fun'}
- Target Total Budget: $${budget || 150}
- Guest Count: ${guestCount?.adults || 10} adults, ${guestCount?.kids || 0} kids (Total: ${(guestCount?.adults || 10) + (guestCount?.kids || 0)})
- Duration: ${durationHours || 3} hours
- Dietary Restrictions: ${Array.isArray(dietaryRestrictions) && dietaryRestrictions.length > 0 ? dietaryRestrictions.join(', ') : 'None specified'}
- Budget Tier Preference: ${budgetTierPreference || 'Balanced Quality'}
- Special Requests & Notes: ${specialRequests || 'None'}

Ensure the items have realistic CymbalMart pricing, unit sizes, accurate portion quantities for ${guestCount?.adults || 10} adults and ${guestCount?.kids || 0} kids, brand tier options (CymbalMart Signature, Fresh, Premium), and stay aligned with the target budget of $${budget || 150}. Return strictly JSON.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.7-flash',
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        temperature: 0.3,
      }
    });

    const responseText = response.text || '';
    let parsedData;
    try {
      parsedData = JSON.parse(responseText);
    } catch (parseErr) {
      console.warn('Failed to parse Gemini JSON output, attempting cleanup or fallback:', parseErr);
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedData = JSON.parse(jsonMatch[0]);
      } else {
        parsedData = getFallbackPlan(req.body);
      }
    }

    // Re-calculate totals to ensure exact mathematical consistency
    if (parsedData && Array.isArray(parsedData.items)) {
      let calcTotal = 0;
      parsedData.items.forEach((item: any) => {
        const itemTotal = (Number(item.unitPrice) || 0) * (Number(item.quantity) || 1);
        calcTotal += itemTotal;
      });
      parsedData.totalEstimatedCost = Number(calcTotal.toFixed(2));
      const targetBudget = Number(budget) || 150;
      parsedData.budgetVariance = Number((targetBudget - calcTotal).toFixed(2));
      const totalGuests = ((Number(guestCount?.adults) || 0) + (Number(guestCount?.kids) || 0)) || 10;
      parsedData.costPerGuest = Number((calcTotal / totalGuests).toFixed(2));
    }

    return res.json(parsedData);
  } catch (error: any) {
    console.error('Error generating party plan:', error);
    return res.json(getFallbackPlan(req.body));
  }
});

// POST /api/refine-plan
app.post('/api/refine-plan', async (req: Request, res: Response) => {
  try {
    const { currentPlan, instruction, eventConfig } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      // Local fallback refinement
      const updatedPlan = { ...currentPlan };
      if (instruction.toLowerCase().includes('cheap') || instruction.toLowerCase().includes('save') || instruction.toLowerCase().includes('budget')) {
        updatedPlan.items = updatedPlan.items.map((item: any) => {
          if (item.tier === 'premium' || item.tier === 'fresh') {
            return {
              ...item,
              brand: 'CymbalMart Signature',
              tier: 'signature',
              unitPrice: +(item.unitPrice * 0.75).toFixed(2)
            };
          }
          return item;
        });
      }
      return res.json({
        updatedPlan,
        explanation: `Refined plan according to: "${instruction}". Adjusted brand tiers and item quantities.`
      });
    }

    const ai = getGenAI();
    const prompt = `
Given the current CymbalMart party shopping plan:
${JSON.stringify(currentPlan, null, 2)}

And the host's event parameters:
${JSON.stringify(eventConfig, null, 2)}

Apply this host modification / refinement request:
"${instruction}"

Rules:
1. Update items, quantities, or brands as requested.
2. If reducing budget, substitute premium items with CymbalMart Signature or Value brands or trim non-essential items.
3. If adjusting for dietary needs (e.g. "vegan only" or "gluten-free"), swap incompatible items for high-rated CymbalMart allergen-friendly alternatives.
4. Recalculate totals and provide an explanation of the specific modifications.

Return JSON in this format:
{
  "updatedPlan": { ...complete updated party plan JSON matching schema... },
  "explanation": "Clear 2-sentence explanation of what was changed, cost impact, and benefits."
}
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.7-flash',
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        temperature: 0.2,
      }
    });

    const responseText = response.text || '';
    const parsedData = JSON.parse(responseText);

    // Recalculate totals
    if (parsedData?.updatedPlan?.items) {
      let calcTotal = 0;
      parsedData.updatedPlan.items.forEach((item: any) => {
        calcTotal += (Number(item.unitPrice) || 0) * (Number(item.quantity) || 1);
      });
      parsedData.updatedPlan.totalEstimatedCost = Number(calcTotal.toFixed(2));
      const targetBudget = Number(eventConfig?.budget) || currentPlan.totalEstimatedCost;
      parsedData.updatedPlan.budgetVariance = Number((targetBudget - calcTotal).toFixed(2));
      const totalGuests = (Number(eventConfig?.guestCount?.adults || 0) + Number(eventConfig?.guestCount?.kids || 0)) || 10;
      parsedData.updatedPlan.costPerGuest = Number((calcTotal / totalGuests).toFixed(2));
    }

    return res.json(parsedData);
  } catch (error: any) {
    console.error('Error refining party plan:', error);
    return res.status(500).json({ error: error.message || 'Failed to refine plan' });
  }
});

// POST /api/chat - CymbalMart Assistant Chatbot
app.post('/api/chat', async (req: Request, res: Response) => {
  try {
    const { messages = [], eventConfig, currentPlan } = req.body;
    const lastUserMessage = messages.filter((m: any) => m.role === 'user').slice(-1)[0]?.content || '';
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      // High quality domain fallback response
      const lower = lastUserMessage.toLowerCase();
      let reply = '';
      let suggestions: string[] = [];

      if (lower.includes('ice') || lower.includes('cold') || lower.includes('cooler')) {
        const guests = eventConfig?.guestCount ? ((eventConfig.guestCount.adults || 0) + (eventConfig.guestCount.kids || 0)) : 15;
        const iceLbs = Math.round(guests * 1.5);
        reply = `For **${guests} guests**, CymbalMart recommends **${iceLbs} lbs of ice** (approx. ${Math.ceil(iceLbs / 10)} x 10lb bags).
\n- **Beverage service:** 0.75 lb/guest for serving in glasses.
- **Cooler chilling:** 0.75 lb/guest for keeping cans and bottles cold.
\nPro tip: Pick up your ice in the last 2 hours before your event using our CymbalMart Curbside Express pickup!`;
        suggestions = ['What about drink quantities?', 'Recommend appetizers', 'Show pickup hours'];
      } else if (lower.includes('budget') || lower.includes('save') || lower.includes('cheap') || lower.includes('cost')) {
        reply = `Here are top budget-saving tips from CymbalMart:
1. **Choose CymbalMart Signature:** Swap national brands for our Signature line to save ~20-25% without sacrificing quality.
2. **Batch Signature Drinks:** Making a large batch punch or mocktail dispenser is up to 40% cheaper than single-serve cans.
3. **Guest Contributions:** Use our *Guest Coordinator* on Step 3 to delegate ice, sodas, and chips to friends!
4. **Smart Proteins:** Choose bone-in cuts, skewers, or gourmet burger slider kits over whole steaks.`;
        suggestions = ['Suggest budget appetizers', 'How to allocate $150?', 'Compare brand tiers'];
      } else if (lower.includes('tropical') || lower.includes('luau') || lower.includes('summer')) {
        reply = `For a vibrant **Tropical Theme**, here are our most popular CymbalMart picks:
- **Mains:** Teriyaki Hawaiian Pineapple Chicken Skewers or Kalua Pork Sliders.
- **Sides:** Mango-Habanero Glazed Meatballs, Coconut Lime Rice, and Plantain Chips with Avocado Salsa.
- **Drinks:** Sparkling Guava-Passionfruit Punch, Coconut Water Spritzers, and Fresh Lime wedges.
- **Decor:** Monstera Leaf placemats, bamboo skewers, and floral hibiscus napkins from our Party Aisle.`;
        suggestions = ['Add tropical items to cart', 'Tropical mocktail recipe', 'How much fruit platter to buy?'];
      } else if (lower.includes('pickup') || lower.includes('delivery') || lower.includes('curbside') || lower.includes('bay')) {
        reply = `**CymbalMart Fulfillment Details:**
- **Curbside Pickup:** 100% Free with temperature-controlled staging bays (Bays 1-16). Available daily 8:00 AM – 9:00 PM in 1-hour windows.
- **Refrigerated Delivery:** Free for party orders over $50. Delivered directly to your door in chilled insulated totes.
- **Vehicle Staging:** Just provide your vehicle make/color at checkout, and our associates will load your trunk within 3 minutes of arrival!`;
        suggestions = ['Where are store locations?', 'Can I edit pickup time?', 'How is meat kept cold?'];
      } else if (lower.includes('diet') || lower.includes('vegan') || lower.includes('gluten') || lower.includes('allergy')) {
        reply = `CymbalMart carries dedicated allergen-friendly and plant-based party staples:
- **Gluten-Free:** Cauliflower crust flatbreads, gluten-free pretzel crisps, and artisan corn tortilla chips.
- **Vegan / Plant-Based:** CymbalMart Green pea-protein burger sliders, dairy-free creamy dill dip, and fresh mezze platters.
- **Nut-Free:** All our celebration cupcakes in the CymbalMart Bakery have clear allergen labeling.`;
        suggestions = ['Substitute dairy dip', 'Kid-friendly vegan snacks', 'Gluten-free dessert ideas'];
      } else {
        reply = `Hello! I'm your **CymbalMart Assistant**. I can help you with:
- **Portion & Drink Calculations** (e.g. "How many burgers and drinks for 20 people?")
- **Menu Curation & Theme Ideas** (BBQ, Tropical Luau, Fiesta, Brunch, Birthdays)
- **Budget Optimization & Brand Swaps** (Signature vs. Everyday Value)
- **Dietary Accommodations** (Vegan, Gluten-Free, Kid-Friendly)
- **Curbside Pickup & Bay Logistics**

How can I assist with your party preparations today?`;
        suggestions = ['Calculate portions for 20 guests', 'Recommend budget party appetizers', 'Explain curbside pickup'];
      }

      return res.json({ message: reply, suggestions });
    }

    const ai = getGenAI();
    const chatPrompt = `You are "CymbalMart Assistant", the friendly, highly knowledgeable AI party concierge and shopping expert for CymbalMart grocery stores.

Current Customer Event Context:
${eventConfig ? JSON.stringify(eventConfig, null, 2) : 'No specific event configured yet.'}

Current Shopping Cart / Plan:
${currentPlan ? `Total: $${currentPlan.totalEstimatedCost} (${currentPlan.items?.length || 0} items). Theme: ${currentPlan.themeVibe}` : 'No cart items yet.'}

Conversation History:
${messages.map((m: any) => `${m.role === 'user' ? 'Customer' : 'CymbalMart Assistant'}: ${m.content}`).join('\n')}

Instructions:
1. Provide a warm, practical, conversational response tailored to the customer's request.
2. If asked about portions, give precise math (e.g., 6-8 oz meat/guest, 1.5 lbs ice/guest, 3 drinks/first 2 hrs).
3. If asked about groceries, recommend specific CymbalMart brand items (CymbalMart Signature, CymbalMart Fresh, Everyday Value).
4. If asked about party logistics, mention our Free Curbside Bay Loading (Bays 1-16) or local refrigerated delivery.
5. Keep the tone enthusiastic, hospitable, helpful, and concise. Use clear markdown formatting.
6. Provide 3 short suggested follow-up questions or action prompts as an array in the output JSON.

Respond with valid JSON:
{
  "message": "Your conversational response in markdown formatting",
  "suggestions": ["Follow-up question 1", "Follow-up question 2", "Follow-up question 3"]
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: chatPrompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.4,
      }
    });

    const responseText = response.text || '';
    const parsed = JSON.parse(responseText);
    return res.json(parsed);
  } catch (error: any) {
    console.error('Error in CymbalMart chat:', error);
    return res.json({
      message: "I'm here to assist with your CymbalMart party shopping! Feel free to ask about portion estimates, budget-saving brand substitutions, dietary options, or curbside pickup.",
      suggestions: ['How much ice do I need?', 'Budget party tips', 'Explain curbside pickup']
    });
  }
});

// Setup Vite middleware in dev or static files in production
const isProduction = process.env.NODE_ENV === 'production';
const PORT = 3000;

async function startServer() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CymbalMart Party Planner Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
