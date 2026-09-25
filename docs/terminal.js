const commands = [
    { text: "./cloudslash scan --profile production", type: "cmd", delay: 800 },
    { text: "Initializing Zero-Trust Graph...", type: "info", delay: 400 },
    { text: "Scanning Region: us-east-1", type: "info", delay: 200 },
    { text: "Analyzing 452 Resources...", type: "info", delay: 600 },
    { text: "⚠ DETECTED: 12 Unused EBS Volumes (stopped > 30d)", type: "warn", delay: 300 },
    { text: "⚠ DETECTED: 5 NAT Gateways (Traffic < 1GB)", type: "warn", delay: 300 },
    { text: "⚠ DETECTED: 2 Abandoned ELBs", type: "warn", delay: 300 },
    { text: "Calculating Waste...", type: "info", delay: 500 },
    { text: "POTENTIAL SAVINGS: $842/month", type: "success", delay: 1000 },
    { text: "", type: "cmd", delay: 2000 } // Pause before restart
];

const terminalBody = document.getElementById('term-body');

const installCommands = {
    unix: 'curl -sL https://raw.githubusercontent.com/DrSkyle/CloudSlash/main/scripts/install.sh | bash',
    win: 'irm https://raw.githubusercontent.com/DrSkyle/CloudSlash/main/scripts/install.ps1 | iex'
};

async function typeWriter(text, element) {
    for (let char of text) {
        element.textContent += char;
        await new Promise(r => setTimeout(r, Math.random() * 30 + 20));
    }
}

async function runTerminal() {
    terminalBody.innerHTML = '';
    
    for (let cmd of commands) {
        const line = document.createElement('div');
        line.className = 'line ' + cmd.type;
        terminalBody.appendChild(line);

        if (cmd.type === 'cmd') {
            const prompt = document.createElement('span');
            prompt.className = 'prompt';
            prompt.textContent = 'user@cloudslash:~$';
            line.appendChild(prompt);
            line.appendChild(document.createTextNode(' '));
            const span = document.createElement('span');
            line.appendChild(span);
            await typeWriter(cmd.text, span);
        } else {
            line.innerText = cmd.text;
        }

        // Auto scroll
        terminalBody.scrollTop = terminalBody.scrollHeight;
        
        await new Promise(r => setTimeout(r, cmd.delay));
    }

    // Loop
    setTimeout(runTerminal, 1000);
}

document.addEventListener('DOMContentLoaded', () => {
    runTerminal();

    const command = document.getElementById('install-cmd');
    const copyButton = document.getElementById('copy-install');
    const tabs = document.querySelectorAll('.os-tab');

    function setOS(os) {
        command.textContent = installCommands[os];
        tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.os === os));
    }

    async function copyInstall() {
        const original = copyButton.querySelector('.copy-icon').innerHTML;
        try {
            await navigator.clipboard.writeText(command.textContent);
        } catch {
            const fallback = document.createElement('textarea');
            fallback.value = command.textContent;
            document.body.appendChild(fallback);
            fallback.select();
            document.execCommand('copy');
            fallback.remove();
        }
        copyButton.classList.add('copied');
        copyButton.querySelector('.copy-icon').innerHTML = '<span class="copied-label">Copied</span>';
        window.setTimeout(() => {
            copyButton.classList.remove('copied');
            copyButton.querySelector('.copy-icon').innerHTML = original;
        }, 1800);
    }

    tabs.forEach((tab) => tab.addEventListener('click', () => setOS(tab.dataset.os)));
    copyButton.addEventListener('click', copyInstall);
    copyButton.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            copyInstall();
        }
    });
});

// Glitch Effect for Logo
const logoText = document.querySelector('.logo-text');
// Add hover listener if needed
// logoText.addEventListener('mouseover', ...);
