import React, { useState, useEffect, useCallback,useContext } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FiSend,
  FiDatabase,
  FiMessageSquare,
  FiCopy,
  FiCheck,
  FiUser,
  FiEdit3,
  FiRefreshCw,
  FiBarChart2,
  FiPieChart,
} from "react-icons/fi";
import { FaCircle } from "react-icons/fa";
import { databaseApi, authApi, ChatWithSQL_API, getSummarizeSQL_API, GetVisualizationSQL_API } from "../../utils/api";
import ViewSelectedDBInfo from "./ViewSelectedDBInfo";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Brain, Sparkles, BarChart3, PieChart as PieChartIcon } from 'lucide-react';
import { LuServerOff } from "react-icons/lu";
import { BiSolidMessageAltError } from "react-icons/bi";
import { IoTimeOutline } from "react-icons/io5";
import { AiOutlineLoading3Quarters } from "react-icons/ai";
import { LazyLoadImage } from "react-lazy-load-image-component";
import { PiLockKeyFill } from "react-icons/pi";

import { SessionIDContext } from "../../context/SessionIDContext";

const statusColors = {
  Connected: "text-green-500",
  Disconnected: "text-red-500",
};

// Animation variants
const statusVariants = {
  hidden: { opacity: 0, x: -10, scale: 0.95 },
  visible: { opacity: 1, x: 0, scale: 1 },
  exit: { opacity: 0, x: -10, scale: 0.95 }
};

const containerVariants = {
  hidden: { opacity: 0, height: 0 },
  visible: {
    opacity: 1,
    height: "auto",
    transition: {
      duration: 0.3,
      ease: "easeOut"
    }
  },
  exit: {
    opacity: 0,
    height: 0,
    transition: {
      duration: 0.2,
      ease: "easeIn"
    }
  }
};

const COLORS = ['#5D3FD3', '#6d4fe4', '#7d5ff5', '#8d6ff6', '#9d7ff7'];

function getToken() {
  return sessionStorage.getItem("token") || localStorage.getItem("token");
}

function getSelectedDbStorageKey() {
  let token = getToken();
  return token ? `selectedDb_${token}` : "selectedDb";
}

function getSessionID() {
  const sessionsdata = JSON.parse(localStorage.getItem(process.env.REACT_APP_SESSIONID_KEY)) || []
  return sessionsdata;
}

const SelectChartStyle = () => `font-medium text-gray-700 bg-white border border-gray-300 w-[90%] text-sm h-9 px-3 py-1 rounded-md focus:outline-none focus:ring-2 focus:ring-[#5D3FD3] focus:border-transparent transition-all duration-200`

// Loading animation component
const LoadingDots = () => (
  <div className="flex space-x-1">
    {[0, 1, 2].map((i) => (
      <motion.div
        key={i}
        className="w-2 h-2 bg-[#5D3FD3] rounded-full"
        animate={{
          scale: [1, 1.5, 1],
          opacity: [0.5, 1, 0.5],
        }}
        transition={{
          duration: 1,
          repeat: Infinity,
          delay: i * 0.2,
        }}
      />
    ))}
  </div>
);

// Thinking animation component
const ThinkingAnimation = () => (
  <div className="flex items-center space-x-2 bg-blue-50 border border-blue-100 rounded-lg p-3 mb-4">
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
    >
      <Brain className="text-blue-500" size={20} />
    </motion.div>
    <div className="flex-1">
      <div className="text-sm text-blue-700 font-medium">QuantChat is thinking</div>
      <div className="text-xs text-blue-600">Analyzing your query and generating insights...</div>
    </div>
    <LoadingDots />
  </div>
);

// Enhanced loading animation for chart images
const ChartLoadingAnimation = () => (
  <div className="w-full h-64 bg-gradient-to-br from-gray-50 to-gray-100 rounded-lg border border-gray-200 flex flex-col items-center justify-center relative overflow-hidden">
    {/* Animated background */}
    <motion.div 
      className="absolute inset-0 bg-gradient-to-r from-transparent via-[#5D3FD3]/10 to-transparent"
      animate={{
        x: ['-100%', '100%'],
      }}
      transition={{
        duration: 1.5,
        repeat: Infinity,
        ease: "easeInOut"
      }}
    />
    
    {/* Main spinner */}
    <motion.div
      className="relative z-10 flex flex-col items-center justify-center"
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
    >
      <motion.div
        className="w-16 h-16 border-4 border-[#5D3FD3]/20 rounded-full mb-4 relative"
        animate={{ rotate: 360 }}
        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
      >
        <div className="absolute top-0 left-0 w-16 h-16 border-4 border-transparent border-t-[#5D3FD3] rounded-full" />
      </motion.div>
      
      {/* Progress dots */}
      <div className="flex space-x-2 mb-4">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-2 h-2 bg-[#5D3FD3] rounded-full"
            animate={{
              scale: [1, 1.5, 1],
              opacity: [0.3, 1, 0.3],
            }}
            transition={{
              duration: 1.2,
              repeat: Infinity,
              delay: i * 0.2,
            }}
          />
        ))}
      </div>
      
      {/* Loading text with progress */}
      <motion.div
        className="text-sm text-gray-600 font-medium"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        Generating Visualization
      </motion.div>
      <motion.div
        className="text-xs text-gray-500 mt-1"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        This may take a few seconds...
      </motion.div>
    </motion.div>
  </div>
);

export default function Chat() {
  const [selectedDb, setSelectedDb] = useState("");
  const [dbStatus, setDbStatus] = useState("");
  const [message, setMessage] = useState("");
  const [copiedItems, setCopiedItems] = useState({});
  const [editingIndex, setEditingIndex] = useState(null);
  const [hoveredMessage, setHoveredMessage] = useState(null);
  const [chats, setChats] = useState([]);
  const [databases, setDatabases] = useState([]);
  const [dbLoading, setDbLoading] = useState(true);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [checkingDbStatus, setCheckingDbStatus] = useState(false);
  const [showDBInfo, setShowDBInfo] = useState(false);
  const [selectedDbDetails, setSelectedDbDetails] = useState(null);
  const [schemaData, setSchemaData] = useState(null);
  const [showStatus, setShowStatus] = useState(false);
  const [isBotTyping, setIsBotTyping] = useState(false);
  const [hasShownWelcomeMessage, setHasShownWelcomeMessage] = useState(false);

  // session id details
  // const [sessionID, setSessionID] = useState([]);
  const {sessionIDData} = useContext(SessionIDContext);
 

  const [currentSelectedID, setCurrentSelectedID] = useState("");
  const [chartType, setChartType] = useState(["Bar Chart", "Pie Chart", "Line Chart", "Histogram", "Scatter Plot"]);
  const [visualizationInputRefs, setVisualizationInputRefs] = useState({});


  

  const getSessionIDWithDBID = (id) => {
    if (id && sessionIDData) {
      const findValue = sessionIDData.filter(val => val.dbid === Number(id));
      if (findValue.length > 0) {
        setCurrentSelectedID(findValue[0].token);
      }else {
        setCurrentSelectedID("");
      }
    }
  }


  useEffect(()=>{
    function clearCurrentSessionID(){
      if (currentSelectedID.length >0) {
        const findvalue = sessionIDData.filter((val) => val.token === currentSelectedID);
        if (findvalue.length === 0){
          setCurrentSelectedID("");
        }
      }
    }
    clearCurrentSessionID();
  },[sessionIDData])

  // On mount, restore selectedDb from localStorage/sessionStorage for this user
  useEffect(() => {
    const dbKey = getSelectedDbStorageKey();
    const storedDb = sessionStorage.getItem(dbKey) || localStorage.getItem(dbKey) || "";
    if (storedDb) {
      setSelectedDb(storedDb);
    }
  }, []);

  // Show welcome message when database is selected
  useEffect(() => {
    if (selectedDb && !hasShownWelcomeMessage) {
      setChats([
        {
          type: "bot",
          text: "Welcome to QuantChat! I can help you query your database using natural language. Just describe what data you're looking for.",
        },
      ]);
      setHasShownWelcomeMessage(true);
    } else if (!selectedDb && hasShownWelcomeMessage) {
      setChats([]);
      setHasShownWelcomeMessage(false);
    }
  }, [selectedDb, hasShownWelcomeMessage]);

  const checkDbStatus = useCallback(async () => {
    if (!selectedDb || !initialLoadComplete) {
      setDbStatus("");
      setShowStatus(false);
      return;
    }

    setCheckingDbStatus(true);
    try {
      const dbDetails = await databaseApi.getDetails(selectedDb);
      getSessionIDWithDBID(dbDetails.id);
      let status = dbDetails.status;
      if (status === "Connected (Warning)") status = "Connected";
      if (
        status === "Testing..." ||
        status === "Connecting..." ||
        status === "Disconnecting..."
      ) {
        status = "Disconnected";
      }
      if (status !== "Connected" && status !== "Disconnected") {
        status = dbDetails.status === "Connected" ? "Connected" : "Disconnected";
      }
      setDbStatus(status);
      setSelectedDbDetails(dbDetails);
      setShowStatus(true);
    } catch (err) {
      setDbStatus("Disconnected");
      setSelectedDbDetails(null);
      setShowStatus(true);
    } finally {
      setCheckingDbStatus(false);
    }
  }, [selectedDb, initialLoadComplete]);

  useEffect(() => {
    let isMounted = true;
    async function fetchAll() {
      setDbLoading(true);
      try {
        const dbListResp = await databaseApi.getAll({ page: 1, limit: 100 });
        const dbList = Array.isArray(dbListResp.databases)
          ? dbListResp.databases.map((db) => ({
            id: db.id?.toString() ?? "",
            name: db.name ?? "(no name)",
          }))
          : [];
        if (isMounted) setDatabases(dbList);

        let token = getToken();
        if (token) {
          try {
            let selectedDbResp = await authApi.getSelectedDatabase();
            let serverSelectedDb = selectedDbResp.success
              ? selectedDbResp.selectedDatabase?.toString()
              : "";
            if (
              serverSelectedDb &&
              dbList.some((db) => db.id === serverSelectedDb)
            ) {
              setSelectedDb(serverSelectedDb);
              const dbKey = getSelectedDbStorageKey();
              sessionStorage.setItem(dbKey, serverSelectedDb);
              localStorage.setItem(dbKey, serverSelectedDb);
            } else {
              setSelectedDb("");
              const dbKey = getSelectedDbStorageKey();
              sessionStorage.removeItem(dbKey);
              localStorage.removeItem(dbKey);
              if (serverSelectedDb) await authApi.setSelectedDatabase("");
            }
          } catch (err) {
            setSelectedDb("");
            const dbKey = getSelectedDbStorageKey();
            sessionStorage.removeItem(dbKey);
              localStorage.removeItem(dbKey);
          }
        }
      } catch (error) {
        setDatabases([]);
        setSelectedDb("");
        const dbKey = getSelectedDbStorageKey();
        sessionStorage.removeItem(dbKey);
        localStorage.removeItem(dbKey);
      } finally {
        if (isMounted) {
          setDbLoading(false);
          // setSessionID(sessionIDData);
          setInitialLoadComplete(true);
        }
      }
    }
    fetchAll();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!initialLoadComplete) return;
    const dbKey = getSelectedDbStorageKey();
    if (selectedDb) {
      sessionStorage.setItem(dbKey, selectedDb);
      localStorage.setItem(dbKey, selectedDb);
    } else {
      sessionStorage.removeItem(dbKey);
      localStorage.removeItem(dbKey);
    }
    let token = getToken();
    if (token) {
      authApi.setSelectedDatabase(selectedDb);
    }
  }, [selectedDb, initialLoadComplete]);

  useEffect(() => {
    checkDbStatus();
  }, [checkDbStatus]);

  const fetchSchemaData = async () => {
    if (!selectedDb || dbStatus !== "Connected") return;

    try {
      const result = await databaseApi.getSchema(selectedDb);
      if (result.success) {
        setSchemaData(result);
      }
    } catch (error) {
      setSchemaData(null);
    }
  };

  const handleShowDBInfo = async () => {
    if (dbStatus === "Connected") {
      await fetchSchemaData();
      setShowDBInfo(true);
    }
  };

  const chatBotResponse = async (userMsg, currentSelectedID) => {
    try {
      setIsBotTyping(true);
      const responseSQLBOT = await ChatWithSQL_API(userMsg, currentSelectedID);
      setIsBotTyping(false);
      return responseSQLBOT;
    } catch (err) {
      console.log(err.message + 'error on chating with bot!')
      return {success:false}
    }
  }

  const handleSend = async () => {
    if (message.trim() === "") return;

    if (!selectedDb) {
      setChats((prev) => [
        ...prev,
        {
          type: "bot",
          text: "Please select a database before chatting.",
        },
      ]);
      setMessage("");
      return;
    }

    const userMessage = message.trim();
    const newChats = [...chats, { type: "user", text: userMessage }];
    setChats(newChats);
    setMessage("");

    if (dbStatus !== "Connected") {
      setChats(prev => [...prev, {
        type: "bot",
        text: "Database is currently disconnected. Your message has been queued and will be processed once the connection is restored.",
        status: "disconnected"
      }]);
      return;
    }

    const botapi_response = await chatBotResponse(userMessage, currentSelectedID);
    const chatID = Date.now();

    if (botapi_response.success) {
      const filterColumnsTable = botapi_response.data.length > 0 ? Object.keys(botapi_response.data[0]) : []
      setChats(prev => [...prev, {
        chatID,
        summarize: { value: "", isloading: false },
        type: "bot",
        text: "I understand you're looking for data insights. While I process your specific query, here's an example of what I can do with your data.",
        sql: botapi_response.sql,
        results: botapi_response.data,
        chartData: { 
          isloading: false, 
          image: "", 
          isVisualForm: false, // Changed to false to hide by default
          question: "", 
          x_axis: "", 
          y_axis: "", 
          charttype: "", 
          dataColumn: filterColumnsTable 
        },
        error: { status: false, message: "" }
      }])
    } else {
      setChats(prev => [...prev, {
        chatID,
        summarize: { value: "", isloading: false },
        type: "bot",
        text: "",
        sql: "",
        results: "",
        chartData: { 
          isloading: false, 
          image: "", 
          isVisualForm: false, // Changed to false to hide by default
          question: "", 
          x_axis: "", 
          y_axis: "", 
          charttype: "", 
          dataColumn: [] 
        },
        error: { status: true, message: botapi_response.message }
      }])
    }
  };

  const handleDbSelect = async (e) => {
    const dbId = e.target.value.toString();
    setSelectedDb(dbId);
    const dbKey = getSelectedDbStorageKey();
    if (dbId) {
      getSessionIDWithDBID(dbId)
      sessionStorage.setItem(dbKey, dbId);
      localStorage.setItem(dbKey, dbId);
    } else {
      sessionStorage.removeItem(dbKey);
      localStorage.removeItem(dbKey);
    }
    setShowDBInfo(false);
  };

  const handleClearDb = () => {
    setSelectedDb("");
    const dbKey = getSelectedDbStorageKey();
    sessionStorage.removeItem(dbKey);
    localStorage.removeItem(dbKey);
    setShowDBInfo(false);
    setShowStatus(false);
  };

  const copyToClipboard = (text, index) => {
    navigator.clipboard.writeText(text);
    setCopiedItems({ ...copiedItems, [index]: true });
    setTimeout(() => {
      setCopiedItems({ ...copiedItems, [index]: false });
    }, 2000);
  };

  const handleEditMessage = (index) => {
    setMessage(chats[index].text);
    setEditingIndex(index);
    setTimeout(() => {
      document.querySelector('input[type="text"]')?.focus();
    }, 100);
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setMessage("");
  };

  const convertNormalText = (summary) => {
    return summary.includes("**") ? summary.replace(/\*\*/g, " ") : summary;
  }

  const GenerateSummarize = async (chat, sessionid) => {
    if (chat.summarize.value) {
      setChats(chats.map((val) => {
        if (chat.chatID === val.chatID) {
          return { ...chat, summarize: { value: "", isloading: false } }
        }
        return val
      }));
    } else {
      setChats(chats.map((val) => {
        if (chat.chatID === val.chatID) {
          return { ...chat, summarize: { ...chat.summarize, isloading: true } };
        }
        return val
      }));

      const respback = await getSummarizeSQL_API(chat.results, sessionid);
      if (respback.success) {
        setChats(chats.map((val) => {
          if (chat.chatID === val.chatID) {
            return {
              ...chat,
              summarize: {
                value: convertNormalText(respback?.summary),
                isloading: false
              }
            };
          }
          return val
        }));
      }else {
        setChats(chats.map((val) => {
          if (chat.chatID === val.chatID) {
            return {
              ...chat,
              summarize: {
                value: convertNormalText(respback?.summary),
                isloading: false
              }
            };
          }
          return val
        }));
      }
    }
  }

  const SelectAxishandler = (event, type, chatid) => {
    if (type === 'x') {
      setChats(chats.map(val => {
        if (val.chatID === chatid) {
          return { ...val, chartData: { ...val.chartData, x_axis: event.target.value } }
        }
        return val
      }))
    } else {
      setChats(chats.map(val => {
        if (val.chatID === chatid) {
          return { ...val, chartData: { ...val.chartData, y_axis: event.target.value } }
        }
        return val
      }))
    }
  }

  const SelectChartType = (event, chatid) => {
    setChats(chats.map(val => {
      if (val.chatID === chatid) {
        return { ...val, chartData: { ...val.chartData, charttype: event.target.value } }
      }
      return val;
    }))
  }

  const OpenChartFormhandle = (chatid) => {
    setChats(chats.map((val) => {
      if (val.type === 'bot' && val.chatID === chatid) {
        const updatedChat = { 
          ...val, 
          chartData: { ...val.chartData, isVisualForm: !val.chartData.isVisualForm } 
        };
        
        // Focus on input when opening the form
        if (updatedChat.chartData.isVisualForm) {
          setTimeout(() => {
            const inputElement = document.getElementById(`chart-input-${chatid}`);
            if (inputElement) {
              inputElement.focus();
            }
          }, 100);
        }
        
        return updatedChat;
      }
      return val;
    }))
  }

  const ChartQuestionQuery = (chatid, event) => {
    setChats(chats.map((val) => {
      if (val.chatID === chatid) {
        return { ...val, chartData: { ...val.chartData, question: event.target.value } }
      }
      return val;
    }))
  }

  const SetPendingVisual = (chatid, value) => {
    setChats(chats.map(val => {
      if (val.chatID === chatid) {
        return { ...val, chartData: { ...val.chartData, isloading: value } }
      }
      return val;
    }))
  }

  const handleChartFormSubmit = (chatid) => {
    SubmitVisualFormhandler(chatid);
  }

  const handleChartInputKeyDown = (e, chatid) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleChartFormSubmit(chatid);
    }
  }

  const SubmitVisualFormhandler = async (chatid) => {
    try {
      const findchat = chats.find((val) => val.chatID === chatid);
      const chatdata = findchat?.chartData

      if (true) {
        const resdata = {
          "session_id": currentSelectedID,
          "data": findchat?.results,
          "user_question": chatdata.question,
          "chart_type": chatdata.charttype,
          "x_axis": chatdata.x_axis,
          "y_axis": chatdata.y_axis
        }
        SetPendingVisual(chatid, true)
        const responseback = await GetVisualizationSQL_API(resdata);
        if (responseback.success) {
          const imageURI = `data:image/png;base64,${responseback.imageURI}`;
          setChats(chats.map(val => {
            if (val.chatID === chatid) {
              return { ...val, chartData: { ...val.chartData, image: imageURI, isloading: false } };
            }
            return val;
          }))
        } else {
          SetPendingVisual(chatid, false)
        }
      }
    } catch (err) {
      console.log(err.message)
    }
  }

  const ErrorStyleChat = (errorFlag) => {
    return errorFlag ? 'bg-red-50 border border-red-100' : ' bg-gray-50 border border-gray-100'
  }

  const renderChart = (chat, index) => {
    if (!chat.chartData) return null;

    const isPieChart = chat.results?.headers?.some(h =>
      h.toLowerCase().includes('category') || h.toLowerCase().includes('type')
    );

    if (isPieChart) {
      return (
        <div className="h-64 mt-4">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chat.chartData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, value }) => `${name}: $${value.toLocaleString()}`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {chat.chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => [`$${value.toLocaleString()}`, 'Value']} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      );
    }

    return (
      <div className="h-64 mt-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chat.chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis tickFormatter={(value) => `$${value.toLocaleString()}`} />
            <Tooltip formatter={(value) => [`$${value.toLocaleString()}`, 'Value']} />
            <Legend />
            <Bar dataKey={chat.chartData[0]?.revenue ? "revenue" : "value"} fill="#5D3FD3" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  };

  const renderChatMessage = (chat, index) => {
    if (chat.type === "user") {
      return (
        <div
          className="flex justify-end relative group"
          onMouseEnter={() => setHoveredMessage(index)}
          onMouseLeave={() => setHoveredMessage(null)}
        >
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="max-w-3xl px-4 py-3 rounded-lg shadow-sm text-sm bg-[#5D3FD3] text-white rounded-br-none relative"
          >
            <div className="flex items-center justify-between">
              <div className="flex-1 pr-4">{chat.text}</div>
              <div className="bg-white p-1 rounded-full flex-shrink-0">
                <FiUser className="text-[#5D3FD3]" size={14} />
              </div>
            </div>
            {(hoveredMessage === index || editingIndex === index) && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex justify-end mt-2 space-x-1 absolute -bottom-2 right-0 bg-white rounded-tl-lg rounded-br-lg p-1 shadow-xs"
              >
                <button
                  onClick={() => handleEditMessage(index)}
                  className="p-1 rounded-full hover:bg-[#5D3FD3] transition-colors group/icon"
                  title="Edit message"
                >
                  <FiEdit3 size={12} className="text-[#5D3FD3] group-hover/icon:text-white" />
                </button>
                <button
                  onClick={() => copyToClipboard(chat.text, `user-${index}`)}
                  className="p-1 rounded-full hover:bg-[#5D3FD3] transition-colors group/icon"
                  title="Copy message"
                >
                  {copiedItems[`user-${index}`] ? (
                    <FiCheck size={12} className="text-green-500" />
                  ) : (
                    <FiCopy size={12} className="text-[#5D3FD3] group-hover/icon:text-white" />
                  )}
                </button>
              </motion.div>
            )}
          </motion.div>
        </div>
      );
    } else if (chat.status === "disconnected") {
      return (
        <div className="flex justify-start">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="max-w-3xl px-4 py-3 rounded-lg shadow-sm text-sm bg-yellow-50 border border-yellow-200 rounded-bl-none"
          >
            <div className="flex items-center mb-2">
              <div className="bg-yellow-500 p-1 rounded-full mr-2">
                <FiDatabase className="text-white" size={14} />
              </div>
              <span className="text-xs text-yellow-700 font-medium">Database Status</span>
            </div>
            <div className="mb-3 text-yellow-700">{chat.text}</div>
            <div className="flex items-center mt-2">
              <button
                onClick={checkDbStatus}
                disabled={checkingDbStatus}
                className="flex items-center text-xs text-yellow-700 hover:text-yellow-800 disabled:opacity-50"
              >
                <FiRefreshCw className={`mr-1 ${checkingDbStatus ? 'animate-spin' : ''}`} size={12} />
                {checkingDbStatus ? 'Checking status...' : 'Retry connection'}
              </button>
            </div>
          </motion.div>
        </div>
      );
    } else {
      return (
        <div className="flex justify-start">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className={`max-w-3xl px-4 py-3 rounded-lg shadow-sm text-sm rounded-bl-none ${ErrorStyleChat(chat?.error?.status)}`}
          >
            <div className="flex items-center mb-2">
              <div className={chat.text ? "bg-[#5D3FD3] p-1 rounded-full mr-2" : "bg-red-600 p-1 rounded-full mr-2"}>
                <FiMessageSquare className="text-white" size={14} />
              </div>
              <span className={chat.text ? "text-xs text-[#5D3FD3] font-medium" : "text-xs text-red-600 font-medium"}>QuantChat</span>
            </div>

            {chat.text ?
              <div className="mb-3 text-gray-700">{chat.text}</div> :

              chat.error.status && <div>
                {chat.error.message === 'ISE' && <div className="my-4 flex items-center text-red-600 text-sm">
                  <LuServerOff className="w-5 h-5 mr-2" /> The server encountered an internal error or misconfiguration and was unable to complete your request
                </div>}

                {chat.error.message === 'SI' && <div className="my-4 flex items-center text-red-600 text-sm">
                  <IoTimeOutline className="w-5 h-5 mr-2" /> Your session has expired. Please connect again
                </div>}

                {chat.error.message === 'SNF' && <div className="my-4 flex items-center text-red-600 text-sm">
                  <PiLockKeyFill className="w-5 h-5 mr-2" /> This action requires an active session. Please connect again for this action
                </div>}

                {(chat.error.message !== 'SI' && chat.error.message !== 'ISE' && chat.error.message !== 'SNF') && <div className="my-4 flex items-center text-red-600 text-sm">
                  <BiSolidMessageAltError className="w-5 h-5 mr-2" /> Something went wrong on our end. Please try again later.
                </div>}

                {/* This action requires an active session. Please log in to perform this action */}
              </div>
            }

            {chat.sql && (
              <div className="mb-4">
                <div className="flex items-center justify-between bg-gray-800 text-gray-100 px-3 py-2 rounded-t-md">
                  <span className="text-xs font-medium">SQL Query</span>
                  <button
                    onClick={() => copyToClipboard(chat.sql, `sql-${index}`)}
                    className="text-gray-300 hover:text-white transition-colors flex items-center"
                  >
                    {copiedItems[`sql-${index}`] ? (
                      <>
                        <FiCheck className="text-green-400 mr-1" />
                        <span className="text-xs">Copied!</span>
                      </>
                    ) : (
                      <>
                        <FiCopy className="mr-1" />
                        <span className="text-xs">Copy</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="bg-gray-900 text-gray-100 p-3 rounded-b-md overflow-x-auto text-xs font-mono">
                  {chat.sql}
                </pre>
              </div>
            )}

            {chat.results && (
              <div className="mt-4">
                <div className="text-xs font-medium text-gray-600 mb-2">
                  Query Results ({chat.results.length} rows):
                </div>
                <div className="border border-gray-300 rounded-lg overflow-hidden shadow-sm mb-3 overflow-x-auto bg-white">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        {Object.keys(chat.results[0]).map((header, i) => (
                          <th
                            key={i}
                            className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b border-gray-300 bg-gray-50/80"
                          >
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {chat.results.map((row, i) => (
                        <tr
                          key={i}
                          className={i % 2 === 0 ? "bg-white hover:bg-gray-50" : "bg-gray-50 hover:bg-gray-100"}
                        >
                          {Object.values(row).map((cell, j) => (
                            <td
                              key={j}
                              className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap border-b border-gray-200"
                            >
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Action Buttons */}
                <div className="flex space-x-3 mt-4">
                  <button
                    onClick={() => GenerateSummarize(chat, currentSelectedID)}
                    className="flex items-center text-xs text-[#5D3FD3] hover:text-[#6d4fe4] font-medium transition-colors disabled:opacity-50"
                  >
                    {chat.summarize.isloading ? (
                      <>
                        <Sparkles className="mr-1 animate-pulse" size={12} />
                        Generating...
                      </>
                    ) : (
                      <>
                        <FiBarChart2 className="mr-1" size={12} />
                        {chat.summarize.value ? 'Hide Summary' : 'Generate Summary'}
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => OpenChartFormhandle(chat.chatID)}
                    className="flex items-center text-xs text-[#5D3FD3] hover:text-[#6d4fe4] font-medium transition-colors disabled:opacity-50"
                  >
                    <>
                      <FiPieChart className="mr-1" size={12} />
                      {chat.chartData.isVisualForm ? 'Hide Visualization' : 'Visualize Data'}
                    </>
                  </button>
                </div>

                {/* Summary Content */}
                <AnimatePresence>
                  {chat.summarize.value !== "" && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.3 }}
                      className="mt-3 overflow-hidden"
                    >
                      <div className="bg-blue-50 border border-blue-100 rounded-md p-3 text-sm text-gray-700">
                        <div className="font-medium text-blue-700 mb-1 flex items-center">
                          <Sparkles className="mr-1" size={14} />
                          Data Summary
                        </div>
                        {chat.summarize.value}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Visualization Content */}
                <AnimatePresence>
                  {chat.chartData.isVisualForm && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.3 }}
                      className="mt-3 overflow-hidden"
                    >
                      <div className="bg-gray-50 border border-gray-200 w-full rounded-lg p-4 shadow-xs">
                        <div className="font-medium text-gray-700 mb-3 flex items-center">
                          <PieChartIcon className="mr-2" size={16} />
                          Data Visualization
                        </div>
                        <div className="data-visual-edit-form my-3 w-full">
                          <div className="chart-config-select-con w-full flex items-center justify-between gap-3 mb-4">
                            {/* Chart type select container */}
                            <div className="select-charttype flex-1">
                              <select 
                                className="font-medium text-gray-700 bg-white border border-gray-300 w-full text-sm h-10 px-3 rounded-md focus:outline-none focus:ring-2 focus:ring-[#5D3FD3] focus:border-transparent transition-all duration-200"
                                onChange={(e) => SelectChartType(e, chat.chatID)}
                                value={chat.chartData.charttype}
                              >
                                <option value="" disabled>Select Chart Type</option>
                                {chartType.map((opt) => (
                                  <option key={opt} value={opt} className="font-medium">
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* Select option for x_axis */}
                            <div className="x_axis-con flex-1">
                              {(chat.chartData.charttype !== "Pie Chart" && chat.chartData.charttype !== "") && (
                                <select 
                                  className="font-medium text-gray-700 bg-white border border-gray-300 w-full text-sm h-10 px-3 rounded-md focus:outline-none focus:ring-2 focus:ring-[#5D3FD3] focus:border-transparent transition-all duration-200"
                                  onChange={(e) => SelectAxishandler(e, 'x', chat.chatID)}
                                  value={chat.chartData.x_axis}
                                >
                                  <option value="" disabled>Select X-axis</option>
                                  {chat.chartData.dataColumn.map((opt, index) => (
                                    chat.chartData.y_axis === opt ?
                                      <option disabled value={opt} key={index}>{opt}</option>
                                      :
                                      <option value={opt} key={index}>{opt}</option>
                                  ))}
                                </select>
                              )}
                            </div>

                            {/* Select option for y_axis */}
                            <div className="y_axis-con flex-1">
                              {(chat.chartData.charttype !== "Pie Chart" && chat.chartData.charttype !== "") && (
                                <select 
                                  className="font-medium text-gray-700 bg-white border border-gray-300 w-full text-sm h-10 px-3 rounded-md focus:outline-none focus:ring-2 focus:ring-[#5D3FD3] focus:border-transparent transition-all duration-200"
                                  onChange={(e) => SelectAxishandler(e, 'y', chat.chatID)}
                                  value={chat.chartData.y_axis}
                                >
                                  <option value="" disabled>Select Y-axis</option>
                                  {chat.chartData.dataColumn.map((opt, index) => (
                                    chat.chartData.x_axis === opt ?
                                      <option disabled value={opt} key={index}>{opt}</option>
                                      :
                                      <option value={opt} key={index}>{opt}</option>
                                  ))}
                                </select>
                              )}
                            </div>
                          </div>

                          <div className="input-con w-full flex items-center gap-2">
                            <input
                              id={`chart-input-${chat.chatID}`}
                              value={chat?.chartData?.question}
                              onChange={(e) => ChartQuestionQuery(chat.chatID, e)}
                              onKeyDown={(e) => handleChartInputKeyDown(e, chat.chatID)}
                              className="flex-1 bg-white h-10 rounded-md font-medium text-sm border border-gray-300 px-3 focus:outline-none focus:ring-2 focus:ring-[#5D3FD3] focus:border-transparent transition-all duration-200"
                              placeholder="Describe the chart you want to generate..."
                            />
                            <button
                              onClick={() => handleChartFormSubmit(chat.chatID)}
                              disabled={chat.chartData.isloading}
                              className="flex items-center justify-center get-chart-btn w-32 bg-[#5D3FD3] hover:bg-[#6d4fe4] h-10 text-sm font-semibold rounded-md text-white transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {chat.chartData.isloading ? (
                                <AiOutlineLoading3Quarters className="animate-spin w-4 h-4" />
                              ) : (
                                'Get Chart'
                              )}
                            </button>
                          </div>

                          {chat.chartData.image !== "" && (
                            <div className="w-full mt-4">
                              <div className="font-medium text-gray-700 mb-3 flex items-center">
                                <BarChart3 className="mr-2" size={16} />
                                Generated Visualization
                              </div>
                              
                              {chat.chartData.isloading ? (
                                <ChartLoadingAnimation />
                              ) : (
                                <motion.div
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ duration: 0.4 }}
                                >
                                  <LazyLoadImage 
                                    effect="opacity" // Changed from "blur" to "opacity" to fix persistent blur
                                    className="w-full rounded-lg border border-gray-200 shadow-sm"
                                    src={chat.chartData.image} 
                                    alt="Generated chart visualization"
                                    placeholder={<ChartLoadingAnimation />}
                                    threshold={100} // Load immediately when in viewport
                                  />
                                </motion.div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        </div>
      );
    }
  };

  const isChatBlocked = !selectedDb;
  const hasRealChats = chats.length > 0;

  return (
    <motion.div
      className="min-h-screen bg-gray-200 flex flex-col"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="flex items-center">
            <FiDatabase className="text-xl text-[#5D3FD3]" />
          </div>
          <div className="flex items-center space-x-2 bg-gray-50 rounded-lg px-3 py-1.5 border border-gray-200">
            <select
              value={selectedDb}
              onChange={handleDbSelect}
              className="bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-[#5D3FD3] focus:border-transparent rounded px-1 w-48 max-w-[180px] sm:max-w-none"
              disabled={dbLoading}
            >
              <option value="">Select Database</option>
              {databases.map((db) => (
                <option key={db.id} value={db.id}>
                  {db.name}
                </option>
              ))}
            </select>
            {selectedDb && (
              <motion.button
                onClick={handleClearDb}
                className="ml-1 px-2 py-1 text-xs rounded bg-gray-200 border border-gray-300 hover:bg-gray-300 text-gray-700 transition"
                title="Clear selection"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                Clear
              </motion.button>
            )}

            <AnimatePresence mode="wait">
              {selectedDb && showStatus && dbStatus && (
                <motion.div
                  key="status-container"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="flex items-center space-x-1 ml-2 overflow-hidden"
                >
                  <motion.div
                    variants={statusVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    className="flex items-center space-x-1"
                  >
                    <FaCircle className={statusColors[dbStatus] + " text-xs"} />
                    <span className="text-xs text-gray-600 hidden sm:inline">{dbStatus}</span>
                    <motion.button
                      onClick={checkDbStatus}
                      disabled={checkingDbStatus}
                      className="ml-1 text-gray-500 hover:text-gray-700 disabled:opacity-50"
                      title="Refresh status"
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <FiRefreshCw className={checkingDbStatus ? 'animate-spin' : ''} size={12} />
                    </motion.button>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <AnimatePresence>
            {selectedDb && dbStatus === "Connected" && (
              <button
                key="db-info-button"
                onClick={handleShowDBInfo}
                className="bg-[#5D3FD3] text-white font-semibold py-2 px-4 rounded hover:bg-[#6d4fe4] transition duration-200 shadow-md focus:outline-none focus:ring-2 focus:ring-[#5D3FD3] focus:ring-offset-2 flex items-center space-x-2"
                title="View Database Information"
              >
                <FiDatabase size={14} />
                <span>View DB Info</span>
              </button>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Database Info Modal */}
      <AnimatePresence>
        {showDBInfo && selectedDbDetails && (
          <ViewSelectedDBInfo
            connection={selectedDbDetails}
            schemaData={schemaData}
            onClose={() => setShowDBInfo(false)}
          />
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Chat Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 max-w-4xl mx-auto w-full">
          {hasRealChats ? (
            <>
              {chats.map((chat, index) => (
                <div key={index}>{renderChatMessage(chat, index)}</div>
              ))}
              {isBotTyping && <ThinkingAnimation />}
            </>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-gray-500 max-w-md mx-auto">
                <FiMessageSquare className="mx-auto text-4xl mb-4 text-gray-300" />
                <p className="text-lg mb-2">Select a database to start chatting</p>
                <p className="text-sm">Choose a database from the dropdown above to begin your conversation with QuantChat</p>
              </div>
            </div>
          )}
        </div>

        {/* Sticky Input Container */}
        <div className="sticky bottom-0 left-0 right-0 bg-gray-200 border-t border-gray-300 z-10">
          <div className="max-w-4xl mx-auto w-full p-4">
            {editingIndex !== null && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-between mb-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-700 shadow-xs"
              >
                <div className="flex items-center">
                  <FiEdit3 className="mr-2 text-blue-500" size={14} />
                  <span>Editing message</span>
                </div>
                <button
                  onClick={cancelEdit}
                  className="text-blue-600 hover:text-blue-800 font-medium text-sm px-2 py-1 rounded-md hover:bg-blue-100 transition-colors"
                >
                  Cancel Edit
                </button>
              </motion.div>
            )}

            <div className="flex items-center space-x-2 w-full">
              <input
                type="text"
                placeholder={
                  !selectedDb
                    ? "Please select a database to chat."
                    : editingIndex !== null
                      ? "Edit your message..."
                      : "Ask about your data..."
                }
                className="flex-1 border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#5D3FD3] focus:border-transparent bg-white shadow-xs"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !isBotTyping && handleSend()}
                disabled={isChatBlocked || isBotTyping}
              />
              <motion.button
                onClick={handleSend}
                className="p-3 rounded-lg bg-[#5D3FD3] text-white hover:bg-[#6d4fe4] transition flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
                disabled={!message.trim() || isChatBlocked || isBotTyping}
                whileHover={{ scale: !message.trim() || isChatBlocked || isBotTyping ? 1 : 1.05 }}
                whileTap={{ scale: !message.trim() || isChatBlocked || isBotTyping ? 1 : 0.95 }}
              >
                {isBotTyping ? <LoadingDots /> : <FiSend className="text-lg" />}
              </motion.button>
            </div>

            <p className="text-xs text-gray-500 mt-2 text-center">
              {!selectedDb
                ? "Please select a database to chat."
                : dbStatus !== "Connected"
                  ? "Database is currently disconnected. Your messages will be queued for processing when the connection is restored."
                  : "QuantChat can make mistakes. Consider checking important information."
              }
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}