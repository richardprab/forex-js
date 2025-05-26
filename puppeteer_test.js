import puppeteer from 'puppeteer';

async function testPuppeteer() {
    try {
        console.log('Testing Puppeteer...');
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto('https://example.com');
        const title = await page.title();
        console.log('Page title:', title);
        await browser.close();
        console.log('✅ Puppeteer test successful!');
    } catch (error) {
        console.error('❌ Puppeteer test failed:', error.message);
    }
}

testPuppeteer();