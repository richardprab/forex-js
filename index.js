import puppeteer from "puppeteer";

const getQuotes = async () => {
    // Start Puppeteer session with
    // - visible browser (`headless: false`) - easier to debug
    // - no default viewport (`defaultViewport: null`) - website page will be in full width & height
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
    });

    // open a new page
    const page = await browser.newPage();

    // on new page:
    // - open "https://quotes.toscrape.com" website
    // - wait until dom content is loaded("HTML ready")
    await page.goto("https://www.cimbniaga.co.id/content/cimb/id/personal/treasury/kurs-valas/jcr:content/responsivegrid/kurs_copy_copy_copy.get-content/", {
        waitUntil: "domcontentloaded",
    });

    

    // Get page data
    const quotes = await page.evaluate(() => {
        // Fetch the first element with the class "quote"
        const quoteList = document.querySelectorAll(".quote");

        // Convert the quoteList into an iterable array
        // For each quote fetch the text & author
        return Array.from(quoteList).map((quote) => {
            // Fetch subelements from previously-fetched quote element
            // Get displayed text and return it
            const text = quote.querySelector(".text").innerText;
            const author = quote.querySelector(".author").innerText;
            return {text, author};
        });
    });

    // display quotes
    console.log(quotes);

    await page.click(".pager > .next > a");

    // close browser
    // await browser.close();
};

// Start scraping
getQuotes();