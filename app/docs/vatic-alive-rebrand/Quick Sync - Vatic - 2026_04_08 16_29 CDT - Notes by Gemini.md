Apr 8, 2026

## Quick Sync \- Vatic

Invited [Anand Iyer](mailto:anand@alivelabs.io) [Bryan Castles](mailto:bryan@alivelabs.io)

Attachments [Quick Sync - Vatic](https://www.google.com/calendar/event?eid=MXBhZmgwZ21pajAzbWZnZmIwbWJqdTk2cG8gYnJ5YW5AYWxpdmVsYWJzLmlv) 

### Summary

Generic platform pivot and brand restructuring featured establishing a generic UI color set for Vatic via global CSS refactoring and creating separate brand identities for Ticket and Neat.

**Strategy Pivot and Restructuring**  
The discussion confirmed the plan to pivot the Vatic platform to a generic framework, leading to the launch of two specialized brands: Ticket for restaurants and Neat for liquor. This required restructuring the Vatic brand back to a generic labs UI color set to establish default values for future iteration.

**Generic UI Color Palette Development**  
The team worked on mapping existing Vatic color tokens from global.css to generic values like brand primary and brand secondary using the alive labs color set. This refactoring involves addressing 34 root tokens and 19 dark mode overrides to ensure the core UI scheme is industry agnostic.

**Code Verticalization and White Label**  
An audit is 80% complete to make the codebase industry agnostic, supporting different industry-specific data points through theme files while keeping the app functionality the same. The strategy focuses on licensing and white-labeling products for enterprise-grade clients like Bacardi to increase company valuation.

### Details

* **Introduction to Managed Agents and Project Management Integration**: Anand Iyer planned to demonstrate how managed agents work by building a demo flow and connecting it to a front end, intending to build a system that processes a sales call transcript and integrates it with a project management tool such as ClickUp or Notion. Bryan Castles initiated the conversation to discuss their approach, clarify expectations, and address the project's strategic pivot.

* **Strategic Pivot to Generic Platform and Brand Restructuring**: The discussion covered the plan to transform the Vatic platform into a generic framework and then launch two specialized brands: Ticket for restaurants and Neat for liquor. This required pivoting the Vatic brand back to a generic labs UI color set to establish default values for iteration and feature additions.

* **Developing a Generic UI Color Palette for Vatic**: Bryan Castles is working to establish a generic UI color set for Vatic, providing a one-to-one mapping so that existing color tokens can be easily replaced with generic values like \`brand primary\` and \`brand secondary\`. They shared their screen to illustrate how they compiled a list of current Vatic palette elements, compared them against the alive labs color set, and identified a small set of colors without a direct match.

* **Refactoring and Mapping Color Tokens in Global CSS**: Anand Iyer confirmed that the core UI color scheme relies on \`global.css\`, requesting confirmation that Bryan Castles' token mapping efforts are based on tokens pulled from this specific file. Bryan Castles confirmed that their process, which involved using a large language model to pull tokens from the website, resulted in 34 root tokens and 19 dark mode overrides from \`global.css\`.

* **Brand Identity and Code Verticalization**: Anand Iyer confirmed understanding the plan to rebrand Vatic to the alive labs color scheme and create separate brand identities for Ticket and Neat, noting that refactoring the code will involve updating the 'get vatic' interface to look like 'alive'. Anand Iyer is performing a verticalization audit of the entire codebase to make it industry agnostic, which is currently about 80% complete, allowing the app functionality to remain the same while supporting different industry-specific data points through theme files.

* **Delivering Color Palettes and Refactoring Tasks**: Bryan Castles is continuing to develop a foundational generic Vatic palette using labs colors, which includes an app UI palette with success and alert colors, intended to be the default palette before branding. Bryan Castles committed to fixing any one-off or VATIC-specific keys by using Claude to find the closest color equivalent and provide a comparison list, which Anand Iyer will use to perform a single-go fix.

* **Theme File Delivery and Marketing Website Plans**: Bryan Castles confirmed they will provide a theme file, including the 19 dark mode overrides, that will allow Anand Iyer to refresh the existing Vatic brand to look like alive labs. Bryan Castles will then repeat this process for Ticket and Neat, planning to build the foundational and marketing sections for these brands on the labs website, standing them up on their respective domains for later ingestion by the application.

* **Questions Regarding Marketing Document and Lead Generation Flow**: Anand Iyer raised concerns about the marketing document, particularly the lead generation flow, which mentions using a HubSpot form or "loops plus Superbase" instead of the current native React form. Bryan Castles clarified that HubSpot is likely intended only for the livelabs.com domain for project inquiries, suggesting that Ticket and Neat should continue using the existing internal mechanism to capture, store, and send alerts using Resend.

* **Product Development and White Label Strategy**: The participants briefly discussed the status of other products, including a beauty product and a vision engineering measuring tool, which are conceptually proven but not fully assembled, requiring a client engagement to finalize their build. Bryan Castles emphasized a strategy to license and white-label products for enterprise-grade clients, such as Bacardi, rather than selling them outright, to increase the company's valuation.

* **Next Steps for UI Implementation and Marketing Review**: Bryan Castles plans to continue work on the generic color scheme and stand up the brand frontends after the Monday meeting to discuss the marketing questions. Anand Iyer will send the verticalization document by the end of the week, and they will hold a follow-up call on Monday to discuss schema updates and hardcoded values required for the code's regression.

### Suggested next steps

- [ ] \[Anand Iyer\] Send Audit: Deliver verticalization audit findings document to Bryan Castles. Send findings by tomorrow or Friday.

- [ ] \[Bryan Castles\] Map Color Tokens: Use Claude Opus to map 16 existing Vatic color token values. Provide Anand Iyer a before-and-after comparison list showing closest color, shade, and contrast equivalents. Include the corresponding theme HTML file and 19 dark mode overrides.

- [ ] \[Bryan Castles\] Build Brand Pages: Build informational sections and marketing pages for Ticket and Neat brands. Stand up built pages on respective domains.

- [ ] \[Anand Iyer\] Refactor Codebase: Implement necessary schema updates and remove hardcoded values like restaurant or VDC. Complete these steps to increase industry agnosticism after document approval.

- [ ] \[Anand Iyer\] Prepare Questions: Write down questions regarding lead generation flow tools (HubSpot, Loops, Resend, Instantly.ai). Discuss discrepancies during the Monday call.

*You should review Gemini's notes to make sure they're accurate. [Get tips and learn how Gemini takes notes](https://support.google.com/meet/answer/14754931)*

*Please provide feedback about using Gemini to take notes in a [short survey.](https://google.qualtrics.com/jfe/form/SV_9vK3UZEaIQKKE7A?confid=AU_vz1HmgHnWCu56GqtFDxIWOAIIigIgABgBCA&detailid=standard)*