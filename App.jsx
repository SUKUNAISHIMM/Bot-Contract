import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Blocks,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clipboard,
  Code2,
  Copy,
  ExternalLink,
  FileCode2,
  History,
  Menu,
  Play,
  RefreshCw,
  Search,
  Send,
  SlidersHorizontal,
  Terminal,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  decodeFunctionData,
  formatEther,
  formatUnits,
  http,
  isAddress,
} from "viem";

const CHAIN_ID = 677;
const RPC_URL = "https://rpc.botchain.ai";
const EXPLORER_URL = "https://scan.botchain.ai";
const EXPLORER_API = `${EXPLORER_URL}/api/v2`;

const BOT_CHAIN = {
  id: CHAIN_ID,
  name: "BOT Chain Mainnet",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] }, public: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "BOTScan", url: EXPLORER_URL } },
};

const publicClient = createPublicClient({ chain: BOT_CHAIN, transport: http(RPC_URL) });

const navItems = [
  { id: "Overview", icon: Blocks },
  { id: "Read", icon: BookOpen },
  { id: "Write", icon: Send },
  { id: "Events", icon: Activity },
  { id: "Transactions", icon: History },
  { id: "Activity", icon: Zap },
  { id: "ABI", icon: Code2 },
  { id: "Source", icon: FileCode2 },
];

const exampleAddress = "0x0000000000000000000000000000000000000000";

function parseAbi(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function shortAddress(value, chars = 6) {
  if (!value) return "—";
  return `${value.slice(0, chars + 2)}…${value.slice(-chars)}`;
}

function shortHash(value) {
  return value ? `${value.slice(0, 10)}…${value.slice(-8)}` : "—";
}

function jsonValue(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  }
  return value;
}

function displayValue(value) {
  if (value === undefined || value === null) return "—";
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return `[${value.map(displayValue).join(", ")}]`;
  if (typeof value === "object") return JSON.stringify(jsonValue(value), null, 2);
  return String(value);
}

function relativeTime(timestamp) {
  if (!timestamp) return "—";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - Number(timestamp));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function fieldPlaceholder(type) {
  if (!type) return "Value";
  if (type === "address") return "0x…";
  if (type === "bool") return "true / false";
  if (type.includes("[]") || type.startsWith("tuple")) return '[ "item 1", "item 2" ]';
  if (type.startsWith("bytes")) return "0x…";
  return "0";
}

function inputLabel(input, index) {
  return input?.name || `arg${index}`;
}

function coerceValue(input, raw) {
  const type = input?.type || "string";
  const value = typeof raw === "string" ? raw.trim() : raw;
  if (type.endsWith("[]")) {
    const parsed = JSON.parse(value || "[]");
    return parsed.map((item) => coerceValue({ ...input, type: type.slice(0, -2) }, item));
  }
  if (type.startsWith("tuple")) return JSON.parse(value || "[]");
  if (/^u?int/.test(type)) return BigInt(value || "0");
  if (type === "bool") return value === true || value.toLowerCase() === "true";
  return value;
}

function explorerLink(path) {
  return `${EXPLORER_URL}${path}`;
}

async function explorerFetch(path) {
  const response = await fetch(`${EXPLORER_API}${path}`);
  if (!response.ok) throw new Error(`BOTScan returned ${response.status}`);
  return response.json();
}

async function optionalExplorer(path) {
  try {
    return await explorerFetch(path);
  } catch {
    return null;
  }
}

function getItems(value) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.items) ? value.items : [];
}

function decodeTransactionMethod(transaction, abi) {
  const decoded = transaction?.decoded_input;
  if (decoded?.method_call) return decoded.method_call.split("(")[0];
  if (decoded?.method_name) return decoded.method_name;
  if (transaction?.method) return transaction.method;
  if (transaction?.input && abi.length) {
    try {
      return decodeFunctionData({ abi, data: transaction.input }).functionName;
    } catch {
      return transaction.input === "0x" ? "native transfer" : "unknown";
    }
  }
  return transaction?.input === "0x" ? "native transfer" : "unknown";
}

function normalizeTransaction(transaction, abi) {
  const hash = transaction.hash || transaction.tx_hash || transaction.transaction_hash;
  return {
    hash,
    method: decodeTransactionMethod(transaction, abi),
    from: transaction.from?.hash || transaction.from || transaction.from_address_hash,
    to: transaction.to?.hash || transaction.to || transaction.to_address_hash,
    value: transaction.value ? `${formatUnits(BigInt(transaction.value), 18)} BOT` : "—",
    block: transaction.block_number || transaction.block || "—",
    status: transaction.status === "error" || transaction.result === "error" ? "Failed" : "Success",
    timestamp: transaction.timestamp || transaction.block_timestamp,
    input: transaction.input || "0x",
    raw: transaction,
  };
}

function normalizeEvent(log, abi) {
  const topics = log.topics || [];
  const address = log.address?.hash || log.address;
  let decoded = log.decoded || null;
  if (!decoded && abi.length && topics.length) {
    try {
      const result = decodeEventLog({
        abi,
        data: log.data || "0x",
        topics,
        strict: false,
      });
      decoded = { eventName: result.eventName, args: jsonValue(result.args) };
    } catch {
      decoded = null;
    }
  }
  return {
    name: decoded?.eventName || log.event_name || log.eventName || "Unknown event",
    block: log.block_number || log.block || "—",
    tx: log.transaction_hash || log.tx_hash || "—",
    timestamp: log.timestamp || log.block_timestamp,
    data: decoded?.args ? JSON.stringify(decoded.args) : `${topics.length} topics · ${log.data || "0x"}`,
    address,
    raw: log,
  };
}

async function loadContract(address) {
  const bytecode = await publicClient.getBytecode({ address });
  if (!bytecode || bytecode === "0x") throw new Error("This address is not a smart contract on BOT Chain.");

  const [details, counters, transactionResponse, logResponse, addressInfo] = await Promise.all([
    optionalExplorer(`/smart-contracts/${address}`),
    optionalExplorer(`/addresses/${address}/counters`),
    optionalExplorer(`/addresses/${address}/transactions?items_count=50&page=1`),
    optionalExplorer(`/addresses/${address}/logs?items_count=50&page=1`),
    optionalExplorer(`/addresses/${address}`),
  ]);

  const abi = parseAbi(details?.abi);
  const balance = await publicClient.getBalance({ address });
  const txItems = getItems(transactionResponse).map((tx) => normalizeTransaction(tx, abi));
  const eventItems = getItems(logResponse).map((log) => normalizeEvent(log, abi));
  const creator =
    details?.creator_address_hash ||
    details?.creator?.hash ||
    details?.creation_tx?.from?.hash ||
    addressInfo?.creator_address_hash ||
    null;

  return {
    address,
    abi,
    details: details || {},
    counters: counters || {},
    addressInfo: addressInfo || {},
    balance,
    transactions: txItems,
    events: eventItems,
    source: details?.source_code || details?.source || "",
    name: details?.name || details?.contract_name || addressInfo?.name || "Unnamed contract",
    creator,
    verified: Boolean(details?.is_verified || details?.verified_twin || details?.source_code),
    partialHistory: !transactionResponse || !logResponse,
  };
}

function App() {
  const [activeView, setActiveView] = useState("Overview");
  const [addressInput, setAddressInput] = useState("");
  const [contract, setContract] = useState(null);
  const [mode, setMode] = useState("empty");
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [wallet, setWallet] = useState({ address: null, chainId: null, balance: null });
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [pendingWrite, setPendingWrite] = useState(null);
  const [txState, setTxState] = useState(null);

  const notify = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  const connectWallet = useCallback(async () => {
    if (!window.ethereum) {
      notify("No browser wallet detected. Install a wallet extension to write.");
      return null;
    }
    try {
      const walletClient = createWalletClient({ chain: BOT_CHAIN, transport: custom(window.ethereum) });
      const [address] = await walletClient.requestAddresses();
      const chainId = await walletClient.getChainId();
      const balance = await publicClient.getBalance({ address });
      const nextWallet = { address, chainId, balance };
      setWallet(nextWallet);
      notify(chainId === CHAIN_ID ? "Wallet connected to BOT Chain" : "Wallet connected — switch to BOT Chain to write");
      return nextWallet;
    } catch (walletError) {
      notify(walletError?.shortMessage || walletError?.message || "Wallet connection was cancelled");
      return null;
    }
  }, [notify]);

  const disconnectWallet = useCallback(() => {
    setWallet({ address: null, chainId: null, balance: null });
    setWalletMenuOpen(false);
    notify("Wallet disconnected");
  }, [notify]);

  const switchNetwork = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${CHAIN_ID.toString(16)}` }],
      });
    } catch (switchError) {
      if (switchError?.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: `0x${CHAIN_ID.toString(16)}`,
            chainName: BOT_CHAIN.name,
            nativeCurrency: BOT_CHAIN.nativeCurrency,
            rpcUrls: [RPC_URL],
            blockExplorerUrls: [EXPLORER_URL],
          }],
        });
      } else {
        notify(switchError?.message || "Network switch was cancelled");
        return;
      }
    }
    await connectWallet();
  }, [connectWallet, notify]);

  useEffect(() => {
    if (!window.ethereum?.on) return undefined;
    const onAccountsChanged = (accounts) => {
      if (!accounts?.length) disconnectWallet();
      else connectWallet();
    };
    const onChainChanged = () => connectWallet();
    window.ethereum.on("accountsChanged", onAccountsChanged);
    window.ethereum.on("chainChanged", onChainChanged);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", onAccountsChanged);
      window.ethereum.removeListener?.("chainChanged", onChainChanged);
    };
  }, [connectWallet, disconnectWallet]);

  const decodeContract = async (eventOrAddress) => {
    eventOrAddress?.preventDefault?.();
    const raw = typeof eventOrAddress === "string" ? eventOrAddress : addressInput;
    const value = raw.trim();
    setAddressInput(value);
    setError("");
    if (!value) {
      setContract(null);
      setMode("empty");
      return;
    }
    if (!isAddress(value)) {
      setContract(null);
      setMode("error");
      setError("Enter a valid EVM address beginning with 0x.");
      return;
    }
    setMode("loading");
    try {
      const normalized = value.toLowerCase();
      const nextContract = await loadContract(normalized);
      setContract(nextContract);
      setMode("loaded");
      setActiveView("Overview");
      notify(nextContract.partialHistory ? "Contract decoded — BOTScan history is partially unavailable" : "Contract interface decoded");
    } catch (loadError) {
      setContract(null);
      setMode("error");
      setError(loadError?.message || "Unable to load this contract.");
    }
  };

  const copy = (value, label = "Copied to clipboard") => {
    navigator.clipboard?.writeText(value);
    notify(label);
  };

  const executeWrite = async (fn, args) => {
    if (!wallet.address) {
      const nextWallet = await connectWallet();
      if (!nextWallet?.address) return;
      if (nextWallet.chainId !== CHAIN_ID) {
        notify("Switch to BOT Chain before executing a write");
        return;
      }
    }
    if (wallet.chainId !== CHAIN_ID) {
      notify("Switch to BOT Chain before executing a write");
      return;
    }
    setPendingWrite({ fn, args });
  };

  const confirmWrite = async () => {
    if (!contract || !pendingWrite || !wallet.address) return;
    const { fn, args } = pendingWrite;
    setPendingWrite(null);
    setTxState({ status: "pending", hash: null, functionName: fn.name });
    try {
      const walletClient = createWalletClient({ account: wallet.address, chain: BOT_CHAIN, transport: custom(window.ethereum) });
      const simulation = await publicClient.simulateContract({
        address: contract.address,
        abi: contract.abi,
        functionName: fn.name,
        args,
        account: wallet.address,
      });
      const hash = await walletClient.writeContract(simulation.request);
      setTxState({ status: "pending", hash, functionName: fn.name });
      notify("Transaction submitted");
      await publicClient.waitForTransactionReceipt({ hash });
      setTxState({ status: "confirmed", hash, functionName: fn.name });
      notify("Transaction confirmed on BOT Chain");
    } catch (writeError) {
      setTxState({ status: "failed", hash: null, functionName: fn.name, error: writeError?.shortMessage || writeError?.message || "Transaction failed" });
      notify("Transaction failed");
    }
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">BOT</div>
          <div>
            <p className="brand-title">BOT Contract<br />Decoder</p>
            <p className="brand-subtitle">chain intelligence / v1.0</p>
          </div>
        </div>
        <div className="side-label">Contract workspace</div>
        <nav className="side-nav" aria-label="Contract views">
          {navItems.map(({ id, icon: Icon }, index) => (
            <button key={id} className={`nav-item ${activeView === id ? "active" : ""}`} onClick={() => { setActiveView(id); setSidebarOpen(false); }} data-testid={`nav-${id.toLowerCase()}`}>
              <Icon size={16} /><span>{id}</span><span className="nav-key">{String(index + 1).padStart(2, "0")}</span>
            </button>
          ))}
        </nav>
        <div className="side-label">Connected network</div>
        <div className="network-card">
          <div className="network-row"><span className="network-name">BOT Chain Mainnet</span><span className="online">online</span></div>
          <div className="network-meta">CHAIN ID&nbsp;&nbsp; 677<br />RPC&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; rpc.botchain.ai</div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setSidebarOpen((open) => !open)} aria-label="Open navigation"><Menu size={17} /></button>
          <div className="crumb">BOT CHAIN / CONTRACTS / <strong>{mode === "loaded" ? "DECODER" : mode.toUpperCase()}</strong></div>
          <div className="top-actions">
            <button className="ghost-button" onClick={() => copy(RPC_URL, "RPC endpoint copied")}><Terminal size={14} /><span>RPC endpoint</span></button>
            {wallet.address ? (
              <div className="wallet-menu-wrap">
                <button className="wallet-chip" onClick={() => setWalletMenuOpen((open) => !open)} aria-expanded={walletMenuOpen}>
                  <span className="wallet-dot" />
                  <span className="mono">{shortAddress(wallet.address)}</span>
                  <span className="wallet-balance">{wallet.balance === null ? "—" : `${Number(formatEther(wallet.balance)).toFixed(4)} BOT`}</span>
                  <ChevronDown size={13} />
                </button>
                {walletMenuOpen && (
                  <div className="wallet-dropdown">
                    <div className="wallet-dropdown-label">CONNECTED WALLET</div>
                    <div className="wallet-dropdown-address mono">{wallet.address}</div>
                    <div className="wallet-dropdown-row"><span>Balance</span><strong>{wallet.balance === null ? "—" : `${Number(formatEther(wallet.balance)).toFixed(4)} BOT`}</strong></div>
                    <div className="wallet-dropdown-row"><span>Network</span><strong className={wallet.chainId === CHAIN_ID ? "online" : "warning-text"}>{wallet.chainId === CHAIN_ID ? "BOT Chain Mainnet" : "Wrong network"}</strong></div>
                    {wallet.chainId !== CHAIN_ID && <button className="dropdown-action" onClick={switchNetwork}>Switch to BOT Chain</button>}
                    <button className="dropdown-action" onClick={() => copy(wallet.address, "Wallet address copied")}>Copy address</button>
                    <a className="dropdown-action" href={explorerLink(`/address/${wallet.address}`)} target="_blank" rel="noreferrer">View on BOTScan <ExternalLink size={12} /></a>
                    <button className="dropdown-action danger" onClick={disconnectWallet}>Disconnect</button>
                  </div>
                )}
              </div>
            ) : (
              <button className="connect-button" onClick={connectWallet}><WalletCards size={14} /> Connect Wallet</button>
            )}
            <button className="icon-button" onClick={() => notify("Network settings are shown in the sidebar")} aria-label="Network settings"><CircleHelp size={16} /></button>
          </div>
        </header>

        <div className="content">
          <div className="hero-line">
            <div>
              <p className="eyebrow">Mainnet inspection tool</p>
              <h1><span className="title-flask">🔬</span> BOT Contract Decoder</h1>
              <p className="hero-copy">Inspect interfaces, query state, decode activity, and prepare signed calls on BOT Chain.</p>
            </div>
            <form className="search-wrap" onSubmit={decodeContract}>
              <Search size={17} />
              <input className="search-input" value={addressInput} onChange={(event) => setAddressInput(event.target.value)} placeholder="Paste BOT Chain contract address..." aria-label="Contract address" />
              <button className="search-submit" type="submit">Decode Contract</button>
            </form>
          </div>

          {mode === "loaded" && contract && (
            <ContractBanner contract={contract} onCopy={copy} onRefresh={() => decodeContract(contract.address)} />
          )}
          {mode === "loading" && <LoadingState />}
          {mode === "error" && <ErrorState message={error} onRetry={() => setAddressInput("")} />}
          {mode === "empty" && <EmptyState onUseExample={() => { setAddressInput(exampleAddress); notify("Example is a placeholder — paste a real BOT Chain contract address to decode"); }} />}

          {mode === "loaded" && contract && (
            <>
              <div className="tabs" role="tablist" aria-label="Contract sections">
                {navItems.map(({ id }) => (
                  <button key={id} className={`tab ${activeView === id ? "active" : ""}`} onClick={() => setActiveView(id)} role="tab" aria-selected={activeView === id}>
                    {id}{(id === "Read" || id === "Write" || id === "Events") && <span className="tab-count">{id === "Read" ? contract.abi.filter((item) => item.type === "function" && ["view", "pure"].includes(item.stateMutability)).length : id === "Write" ? contract.abi.filter((item) => item.type === "function" && !["view", "pure"].includes(item.stateMutability)).length : contract.events.length}</span>}
                  </button>
                ))}
              </div>
              <ViewContent view={activeView} contract={contract} onCopy={copy} notify={notify} onExecute={executeWrite} txState={txState} />
            </>
          )}
        </div>
      </main>

      {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
      {pendingWrite && <WriteModal contract={contract} wallet={wallet} fn={pendingWrite.fn} args={pendingWrite.args} onClose={() => setPendingWrite(null)} onConfirm={confirmWrite} />}
      {txState && <TxStatus state={txState} onClose={() => setTxState(null)} />}
    </div>
  );
}

function ContractBanner({ contract, onCopy, onRefresh }) {
  const details = contract.details || {};
  const txCount = contract.counters?.transactions_count || contract.counters?.transactions || contract.addressInfo?.transactions_count || contract.transactions.length;
  return (
    <section className="contract-banner">
      <div className="contract-top">
        <div className="contract-id">
          <div className="contract-mark"><FileCode2 size={18} /></div>
          <div><div className="contract-name">{contract.name}</div><div className="contract-address">{contract.address}</div></div>
        </div>
        <div className="badges">
          <span className={`badge ${contract.verified ? "verified" : "unverified"}`}>{contract.verified ? "VERIFIED SOURCE" : "SOURCE UNVERIFIED"}</span>
          <span className="badge network">BOT MAINNET</span>
          <button className="icon-button small" onClick={onRefresh} aria-label="Refresh contract"><RefreshCw size={14} /></button>
        </div>
      </div>
      <div className="banner-metrics">
        <Metric label="Verification" value={contract.verified ? details.compiler_version || "Verified" : "Not verified"} />
        <Metric label="Balance" value={`${Number(formatEther(contract.balance)).toFixed(4)} BOT`} />
        <Metric label="Transactions" value={String(txCount)} />
        <Metric label="Creator" value={shortAddress(contract.creator)} />
        <div className="metric-explorer"><a href={explorerLink(`/address/${contract.address}`)} target="_blank" rel="noreferrer">View on BOTScan <ExternalLink size={10} /></a></div>
        <button className="copy-mini" onClick={() => onCopy(contract.address, "Contract address copied")} aria-label="Copy contract address"><Copy size={13} /></button>
      </div>
    </section>
  );
}

function Metric({ label, value }) {
  return <div><div className="metric-label">{label}</div><div className="metric-value mono">{value}</div></div>;
}

function ViewContent({ view, contract, onCopy, notify, onExecute, txState }) {
  if (view === "Overview") return <Overview contract={contract} onCopy={onCopy} />;
  if (view === "Read") return <FunctionPanel contract={contract} kind="read" notify={notify} />;
  if (view === "Write") return <FunctionPanel contract={contract} kind="write" notify={notify} onExecute={onExecute} />;
  if (view === "Events") return <Events contract={contract} notify={notify} />;
  if (view === "Transactions") return <Transactions contract={contract} notify={notify} />;
  if (view === "Activity") return <ActivityView contract={contract} />;
  if (view === "ABI") return <AbiView contract={contract} onCopy={onCopy} />;
  return <SourceView contract={contract} onCopy={onCopy} />;
}

function Overview({ contract, onCopy }) {
  const details = contract.details || {};
  return (
    <>
      <div className="toolbar"><div><h2 className="section-title">Contract overview</h2><p className="section-subtitle">Identity, implementation, and indexed chain activity.</p></div><div className="button-row"><button className="ghost-button" onClick={() => onCopy(explorerLink(`/address/${contract.address}`), "BOTScan link copied")}><Clipboard size={14} /> Copy link</button><a className="primary-button" href={explorerLink(`/address/${contract.address}`)} target="_blank" rel="noreferrer">Open explorer <ArrowUpRight size={14} /></a></div></div>
      <div className="summary-grid">
        <div className="panel">
          <div className="panel-heading"><h3>Interface snapshot</h3><span className="panel-kicker">{contract.abi.length ? "ABI DECODED" : "ABI UNAVAILABLE"}</span></div>
          <div className="panel-body">
            <div className="code-block">
              <div className="code-comment">// decoded contract metadata</div>
              <div><span className="code-key">contract</span>: <span className="code-value">"{contract.name}"</span>,</div>
              <div><span className="code-key">compiler</span>: <span className="code-value">"{details.compiler_version || "unavailable"}"</span>,</div>
              <div><span className="code-key">optimization</span>: <span className="code-value">"{details.optimization_enabled === true ? "enabled" : details.optimization_enabled === false ? "disabled" : "unavailable"}"</span>,</div>
              <div><span className="code-key">proxy</span>: <span className="code-value">{String(Boolean(details.proxy_type || details.implementations?.length))}</span>,</div>
              <div><span className="code-key">implementation</span>: <span className="code-value">"{details.implementations?.[0]?.address_hash || "self"}"</span></div>
            </div>
            <div className="kv-list compact-list">
              <div className="kv-row"><span className="kv-label">Contract creator</span><span className="kv-value mono">{shortAddress(contract.creator)}</span></div>
              <div className="kv-row"><span className="kv-label">Creation block</span><span className="kv-value mono">{details.creation_block_number || details.creation_tx_block_number || "—"}</span></div>
              <div className="kv-row"><span className="kv-label">Latest activity</span><span className="kv-value mono">{relativeTime(contract.transactions[0]?.timestamp || contract.events[0]?.timestamp)}</span></div>
            </div>
          </div>
        </div>
        <div className="overview-side">
          <div className="panel"><div className="panel-heading"><h3>ABI inventory</h3><span className="panel-kicker">LIVE</span></div><div className="panel-body kv-list"><div className="kv-row"><span className="kv-label">Functions</span><span className="kv-value">{contract.abi.filter((item) => item.type === "function").length}</span></div><div className="kv-row"><span className="kv-label">Read methods</span><span className="kv-value">{contract.abi.filter((item) => item.type === "function" && ["view", "pure"].includes(item.stateMutability)).length}</span></div><div className="kv-row"><span className="kv-label">Write methods</span><span className="kv-value">{contract.abi.filter((item) => item.type === "function" && !["view", "pure"].includes(item.stateMutability)).length}</span></div><div className="kv-row"><span className="kv-label">Events</span><span className="kv-value">{contract.abi.filter((item) => item.type === "event").length}</span></div></div></div>
          <div className="panel"><div className="panel-heading"><h3>Index status</h3><span className={contract.partialHistory ? "warning-text" : "online"}>{contract.partialHistory ? "partial" : "synced"}</span></div><div className="panel-body kv-list"><div className="kv-row"><span className="kv-label">Transactions loaded</span><span className="kv-value">{contract.transactions.length}</span></div><div className="kv-row"><span className="kv-label">Events loaded</span><span className="kv-value">{contract.events.length}</span></div><div className="kv-row"><span className="kv-label">Source</span><span className="kv-value">{contract.source ? "available" : "not verified"}</span></div></div></div>
        </div>
      </div>
      <div className="panel section-gap"><div className="panel-heading"><div><h3>Recent transactions</h3><p className="section-subtitle">Indexed from BOTScan; select a hash for details.</p></div><button className="ghost-button" onClick={() => onCopy(JSON.stringify(contract.transactions, null, 2), "Transactions copied")}><Copy size={14} /> Copy data</button></div><TransactionTable rows={contract.transactions.slice(0, 5)} /></div>
    </>
  );
}

function FunctionPanel({ contract, kind, notify, onExecute }) {
  const isRead = kind === "read";
  const functions = contract.abi.filter((item) => item.type === "function" && (isRead ? ["view", "pure"].includes(item.stateMutability) : !["view", "pure"].includes(item.stateMutability)));
  return (
    <div className="panel">
      <div className="panel-heading"><div><h3>{isRead ? "Read contract" : "Write contract"}</h3><p className="section-subtitle">{isRead ? "Call view and pure methods without signing a transaction." : "Prepare a state-changing call. Your wallet will review it before sending."}</p></div><span className="badge muted">{functions.length} METHODS</span></div>
      <div className="panel-body">{functions.length ? <div className="function-list">{functions.map((fn, index) => <FunctionRow key={`${fn.name}-${index}`} contract={contract} fn={fn} isRead={isRead} notify={notify} onExecute={onExecute} />)}</div> : <InlineEmpty title={isRead ? "No read methods found" : "No write methods found"} copy={contract.abi.length ? "The decoded ABI does not expose methods in this category." : "BOTScan did not return a verified ABI for this contract."} />}</div>
    </div>
  );
}

function FunctionRow({ contract, fn, isRead, notify, onExecute }) {
  const [expanded, setExpanded] = useState(false);
  const [values, setValues] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputs = fn.inputs || [];
  const signature = `${fn.name}(${inputs.map((input) => input.type).join(", ")})`;
  const updateValue = (key, value) => setValues((current) => ({ ...current, [key]: value }));

  const query = async () => {
    setBusy(true);
    try {
      const args = inputs.map((input, index) => coerceValue(input, values[inputLabel(input, index)] || ""));
      const response = await publicClient.readContract({ address: contract.address, abi: contract.abi, functionName: fn.name, args });
      setResult({ ok: true, value: displayValue(response) });
      notify(`${fn.name}() returned a result`);
    } catch (queryError) {
      setResult({ ok: false, value: queryError?.shortMessage || queryError?.message || "Query failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="function-row">
      <button className="function-head" onClick={() => setExpanded((open) => !open)} aria-expanded={expanded}>
        <span className={`pill-method ${isRead ? "" : "write"}`}>{isRead ? "view" : "write"}</span><span className="function-name">{fn.name}</span><span className="function-signature">{signature}</span>{expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      {expanded && <div className="function-form">
        {inputs.length ? <div className="field-grid">{inputs.map((input, index) => <label className="field" key={`${inputLabel(input, index)}-${index}`}><span className="field-label">{inputLabel(input, index)} <em>{input.type}</em></span><input className="field-input" value={values[inputLabel(input, index)] || ""} onChange={(event) => updateValue(inputLabel(input, index), event.target.value)} placeholder={fieldPlaceholder(input.type)} /></label>)}</div> : <p className="muted-copy">This method takes no parameters.</p>}
        {isRead ? <><button className="primary-button small-button" onClick={query} disabled={busy}><Play size={13} /> {busy ? "Querying…" : "Query"}</button>{result && <div className={`result-block ${result.ok ? "success" : "failure"}`}><span className="code-comment">{result.ok ? "result" : "error"}</span><pre>{result.value}</pre></div>}</> : <><div className="write-note">This call changes contract state. The transaction will be simulated, then your wallet will show a confirmation dialog before sending.</div><button className="primary-button small-button" onClick={async () => { try { const args = inputs.map((input, index) => coerceValue(input, values[inputLabel(input, index)] || "")); onExecute(fn, args); } catch (error) { notify(error?.message || "Check the parameter values"); } }}><Send size={13} /> Execute</button></>}
      </div>}
    </div>
  );
}

function Events({ contract }) {
  const [filter, setFilter] = useState("all");
  const eventNames = [...new Set(contract.events.map((event) => event.name))];
  const rows = filter === "all" ? contract.events : contract.events.filter((event) => event.name === filter);
  return <div className="panel"><div className="panel-heading"><div><h3>Event log</h3><p className="section-subtitle">Decoded logs from BOTScan; history does not depend on eth_getLogs.</p></div><select className="field-select compact-select" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter events"><option value="all">All events</option>{eventNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></div>{rows.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Event</th><th>Block</th><th>Transaction</th><th>Decoded parameters</th><th>Age</th></tr></thead><tbody>{rows.map((event, index) => <tr key={`${event.tx}-${index}`}><td><span className="event-topic">{event.name}</span></td><td className="mono"><a href={explorerLink(`/block/${event.block}`)} target="_blank" rel="noreferrer">{event.block}</a></td><td className="mono linkish"><a href={explorerLink(`/tx/${event.tx}`)} target="_blank" rel="noreferrer">{shortHash(event.tx)}</a></td><td className="mono data-cell">{event.data}</td><td className="mono muted-copy">{relativeTime(event.timestamp)}</td></tr>)}</tbody></table></div> : <InlineEmpty title="No events indexed" copy="BOTScan returned no historical logs for this address." />}</div>;
}

function Transactions({ contract }) {
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const methods = [...new Set(contract.transactions.map((tx) => tx.method))];
  const rows = filter === "all" ? contract.transactions : contract.transactions.filter((tx) => tx.method === filter);
  return <div className="panel"><div className="panel-heading"><div><h3>Transaction history</h3><p className="section-subtitle">Calls indexed from BOTScan, with ABI method decoding when available.</p></div><select className="field-select compact-select" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter transactions"><option value="all">All methods</option>{methods.map((method) => <option key={method} value={method}>{method}</option>)}</select></div>{rows.length ? <TransactionTable rows={rows} onSelect={setSelected} /> : <InlineEmpty title="No transactions indexed" copy="BOTScan did not return history for this address." />}{selected && <TransactionDetail transaction={selected} onClose={() => setSelected(null)} />}</div>;
}

function TransactionTable({ rows, onSelect }) {
  return <div className="table-wrap"><table className="data-table"><thead><tr><th>Hash</th><th>Method</th><th>From</th><th>Value</th><th>Block</th><th>Status</th></tr></thead><tbody>{rows.map((tx, index) => <tr key={`${tx.hash}-${index}`} onClick={() => onSelect?.(tx)} className={onSelect ? "clickable-row" : ""}><td className="mono linkish"><a href={explorerLink(`/tx/${tx.hash}`)} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{shortHash(tx.hash)}</a></td><td><span className={`pill-method ${tx.method !== "native transfer" ? "write" : ""}`}>{tx.method}</span></td><td className="mono">{shortAddress(tx.from)}</td><td className="mono">{tx.value}</td><td className="mono"><a href={explorerLink(`/block/${tx.block}`)} target="_blank" rel="noreferrer">{tx.block}</a></td><td><span className={`status-dot ${tx.status === "Failed" ? "fail" : ""}`} />{tx.status}</td></tr>)}</tbody></table></div>;
}

function TransactionDetail({ transaction, onClose }) {
  return <div className="detail-drawer"><div className="detail-head"><div><p className="eyebrow">Transaction detail</p><h3>{transaction.method}</h3></div><button className="icon-button" onClick={onClose} aria-label="Close details"><X size={15} /></button></div><div className="detail-grid"><div><span>Hash</span><strong className="mono">{transaction.hash}</strong></div><div><span>From</span><strong className="mono">{transaction.from}</strong></div><div><span>To</span><strong className="mono">{transaction.to || "—"}</strong></div><div><span>Calldata</span><strong className="mono calldata">{transaction.input || "0x"}</strong></div></div><a className="primary-button" href={explorerLink(`/tx/${transaction.hash}`)} target="_blank" rel="noreferrer">View on BOTScan <ExternalLink size={13} /></a></div>;
}

function ActivityView({ contract }) {
  const feed = useMemo(() => [...contract.transactions.map((tx) => ({ kind: "CALL", title: tx.method, copy: `${shortAddress(tx.from)} → ${shortAddress(tx.to)}`, block: tx.block, timestamp: tx.timestamp, hash: tx.hash })), ...contract.events.map((event) => ({ kind: "EVENT", title: event.name, copy: event.data, block: event.block, timestamp: event.timestamp, hash: event.tx }))].sort((a, b) => Number(b.block || 0) - Number(a.block || 0)), [contract]);
  return <div className="summary-grid"><div className="panel"><div className="panel-heading"><div><h3>Contract activity</h3><p className="section-subtitle">A chronological stream of calls and decoded events.</p></div><span className="badge muted">{feed.length} ITEMS</span></div><div className="panel-body"><div className="activity-feed">{feed.slice(0, 50).map((item, index) => <div className="activity-row" key={`${item.hash}-${index}`}><span className={`activity-dot ${item.kind.toLowerCase()}`} /><div><div className="activity-title"><span className="activity-kind">{item.kind}</span>{item.title}</div><div className="muted-copy">{item.copy}</div><a className="mono linkish" href={explorerLink(`/tx/${item.hash}`)} target="_blank" rel="noreferrer">block {item.block}</a></div><span className="mono muted-copy nowrap">{relativeTime(item.timestamp)}</span></div>)}</div>{feed.length > 50 && <p className="muted-copy feed-foot">Showing latest 50 indexed items.</p>}</div></div><div className="overview-side"><div className="panel"><div className="panel-heading"><h3>Index source</h3><span className="online">live</span></div><div className="panel-body kv-list"><div className="kv-row"><span className="kv-label">History provider</span><span className="kv-value mono">BOTScan API</span></div><div className="kv-row"><span className="kv-label">RPC reads</span><span className="kv-value mono">BOT Chain RPC</span></div><div className="kv-row"><span className="kv-label">Log strategy</span><span className="kv-value mono">Explorer indexed</span></div></div></div></div></div>;
}

function AbiView({ contract, onCopy }) {
  const [search, setSearch] = useState("");
  const formatted = JSON.stringify(contract.abi, null, 2);
  const visible = search ? contract.abi.filter((item) => JSON.stringify(item).toLowerCase().includes(search.toLowerCase())) : contract.abi;
  return <div className="abi-layout"><div className="panel"><div className="panel-heading"><div><h3>Contract ABI</h3><p className="section-subtitle">The exact interface returned by BOTScan.</p></div><div className="button-row"><button className="ghost-button" onClick={() => onCopy(formatted, "ABI copied to clipboard")}><Copy size={13} /> Copy</button><button className="ghost-button" onClick={() => { const blob = new Blob([formatted], { type: "application/json" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${contract.address}.abi.json`; link.click(); URL.revokeObjectURL(link.href); }}><ArrowUpRight size={13} /> Download</button></div></div><div className="abi-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search ABI..." /></div><pre className="json-block">{JSON.stringify(visible, null, 2)}</pre></div><div className="panel"><div className="panel-heading"><h3>ABI summary</h3><span className="panel-kicker">SOLIDITY ABI</span></div><div className="panel-body kv-list"><div className="kv-row"><span className="kv-label">Functions</span><span className="kv-value">{contract.abi.filter((item) => item.type === "function").length}</span></div><div className="kv-row"><span className="kv-label">Events</span><span className="kv-value">{contract.abi.filter((item) => item.type === "event").length}</span></div><div className="kv-row"><span className="kv-label">Errors</span><span className="kv-value">{contract.abi.filter((item) => item.type === "error").length}</span></div><div className="kv-row"><span className="kv-label">Items shown</span><span className="kv-value">{visible.length} / {contract.abi.length}</span></div></div></div></div>;
}

function SourceView({ contract, onCopy }) {
  if (!contract.source) return <div className="panel empty-state"><div className="state-icon"><FileCode2 size={18} /></div><h2 className="state-title">Source code has not been verified for this contract.</h2><p className="state-copy">Verified Solidity source will appear here when BOTScan publishes it.</p><a className="ghost-button inline-button" href={explorerLink(`/address/${contract.address}`)} target="_blank" rel="noreferrer">Check BOTScan <ExternalLink size={13} /></a></div>;
  const lines = contract.source.split(/\r?\n/);
  return <div className="panel"><div className="panel-heading"><div><h3>Verified source</h3><p className="section-subtitle">{contract.name} · Solidity source from BOTScan</p></div><div className="button-row"><button className="ghost-button" onClick={() => onCopy(contract.source, "Source copied to clipboard")}><Copy size={13} /> Copy source</button><a className="ghost-button" href={explorerLink(`/address/${contract.address}`)} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Explorer</a></div></div><div className="source-editor">{lines.map((line, index) => <span className={`source-line ${/^\s*(contract|function|event|struct|interface|pragma)/.test(line) ? "syntax-key" : line.trim().startsWith("//") ? "syntax-note" : ""}`} key={index}>{line || " "}</span>)}</div></div>;
}

function WriteModal({ contract, wallet, fn, args, onClose, onConfirm }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="write-title"><div className="modal-head"><div><p className="eyebrow">Wallet confirmation</p><h2 className="modal-title" id="write-title">Confirm {fn.name}()</h2></div><button className="icon-button" onClick={onClose} aria-label="Close confirmation"><X size={16} /></button></div><div className="modal-body"><div className="write-note">Review the parameters below. Nothing has been sent yet. Your wallet will perform the final signature.</div><div className="kv-list modal-list"><div className="kv-row"><span className="kv-label">Network</span><span className="kv-value mono">BOT Chain Mainnet (677)</span></div><div className="kv-row"><span className="kv-label">Contract</span><span className="kv-value mono">{shortAddress(contract.address)}</span></div><div className="kv-row"><span className="kv-label">Wallet</span><span className="kv-value mono">{shortAddress(wallet.address)}</span></div>{(fn.inputs || []).map((input, index) => <div className="kv-row" key={index}><span className="kv-label">{inputLabel(input, index)}</span><span className="kv-value mono">{displayValue(args[index])}</span></div>)}</div><div className="modal-actions"><button className="ghost-button" onClick={onClose}>Cancel</button><button className="primary-button" onClick={onConfirm}><Send size={14} /> Continue to wallet</button></div></div></div></div>;
}

function TxStatus({ state, onClose }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal status-modal" role="dialog" aria-modal="true"><div className="modal-head"><div><p className="eyebrow">Transaction status</p><h2 className="modal-title">{state.functionName}()</h2></div><button className="icon-button" onClick={onClose} aria-label="Close status"><X size={16} /></button></div><div className="modal-body status-body"><div className={`status-icon ${state.status}`}><span>{state.status === "pending" ? "…" : state.status === "confirmed" ? "✓" : "!"}</span></div><h3>{state.status === "pending" ? "Pending" : state.status === "confirmed" ? "Confirmed" : "Failed"}</h3><p className="muted-copy">{state.error || (state.status === "pending" ? "Waiting for the BOT Chain receipt." : state.status === "confirmed" ? "The state change is confirmed on BOT Chain Mainnet." : "The wallet or RPC rejected this transaction.")}</p>{state.hash && <><div className="hash-box mono">{state.hash}</div><a className="primary-button" href={explorerLink(`/tx/${state.hash}`)} target="_blank" rel="noreferrer">View on BOTScan <ExternalLink size={13} /></a></>}</div></div></div>;
}

function LoadingState() {
  return <div className="panel loading-state"><div className="spinner" /><h2 className="state-title">Resolving contract interface</h2><p className="state-copy">Checking bytecode on BOT Chain, then loading ABI and indexed history from BOTScan.</p><div className="loading-steps"><span>bytecode</span><span>ABI</span><span>history</span></div></div>;
}

function ErrorState({ message, onRetry }) {
  return <div className="panel error-state"><div className="state-icon danger"><AlertTriangle size={19} /></div><h2 className="state-title">Unable to decode this address</h2><p className="state-copy">{message}</p><button className="primary-button" onClick={onRetry}><RefreshCw size={14} /> Try another address</button></div>;
}

function EmptyState({ onUseExample }) {
  return <div className="panel empty-state"><div className="state-icon"><Search size={18} /></div><h2 className="state-title">Start with a BOT Chain contract</h2><p className="state-copy">Paste a real deployed address above. The decoder verifies bytecode, loads the available interface, and makes callable methods available here.</p><button className="ghost-button inline-button" onClick={onUseExample}>What can I inspect?</button></div>;
}

function InlineEmpty({ title, copy }) {
  return <div className="inline-empty"><SlidersHorizontal size={17} /><div><strong>{title}</strong><p>{copy}</p></div></div>;
}

export default App;