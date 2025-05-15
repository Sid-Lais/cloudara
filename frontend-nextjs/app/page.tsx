"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import axios from "axios";
import { AnimatePresence, motion } from "framer-motion";
import { Github } from "lucide-react";
import { Fira_Code } from "next/font/google";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

const socket = io("http://localhost:9002");

const firaCode = Fira_Code({ subsets: ["latin"] });

// Particle effect component for mouse trail
const MouseParticles = () => {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [particles, setParticles] = useState<{ x: number; y: number; id: number }[]>([]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });

      // Add new particle at current mouse position
      const newParticle = {
        x: e.clientX,
        y: e.clientY,
        id: Date.now()
      };

      setParticles(prev => [...prev, newParticle].slice(-15)); // Keep only the last 15 particles
    };

    window.addEventListener("mousemove", handleMouseMove);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-30 overflow-hidden">
      {particles.map((particle, i) => (
        <motion.div
          key={particle.id}
          className="absolute h-2 w-2 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500"
          initial={{ opacity: 0.8, scale: 1 }}
          animate={{
            opacity: 0,
            scale: 0,
            x: particle.x,
            y: particle.y
          }}
          transition={{ duration: 1, ease: "easeOut" }}
          style={{
            left: particle.x,
            top: particle.y,
            opacity: 1 - i * 0.1,
          }}
        />
      ))}
    </div>
  );
};

export default function Home() {
  const [repoURL, setURL] = useState<string>("");
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [projectId, setProjectId] = useState<string | undefined>();
  const [deployPreviewURL, setDeployPreviewURL] = useState<string | undefined>();
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const [pollingLogs, setPollingLogs] = useState(false);
  const logContainerRef = useRef<HTMLElement>(null);

  const isValidURL = useMemo(() => {
    if (!repoURL || repoURL.trim() === "") return [false, null];

    // Try to parse the URL first to handle various formats
    try {
      const url = new URL(repoURL);
      const pathParts = url.pathname.split('/').filter(Boolean);

      // GitHub URLs should have at least 2 parts: username/repo
      if (url.hostname === 'github.com' && pathParts.length >= 2) {
        return [true, null];
      }
    } catch (e) {
      // If not a valid URL, try regex for non-URL format
      const githubRegex = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/]+)\/([^\/]+)(?:\/.*)?$/;
      if (githubRegex.test(repoURL)) {
        return [true, null];
      }
    }

    return [false, "Enter valid Github Repository URL"];
  }, [repoURL]);

  const handleClickDeploy = useCallback(async () => {
    setLoading(true);
    setLogs([]);

    try {
        // Format the GitHub URL to ensure it ends with .git
        let formattedGitURL = repoURL;
        if (!formattedGitURL.endsWith('.git')) {
            formattedGitURL = `${formattedGitURL}.git`;
        }

        // Extract the repo name from the URL
        const urlParts = formattedGitURL.split('/');
        const repoName = urlParts[urlParts.length - 1].replace('.git', '');

        // First create a project
        const { data: projectData } = await axios.post(`http://localhost:9000/project`, {
            name: repoName,
            gitURL: formattedGitURL
        });

        if (projectData?.data?.project) {
            const project = projectData.data.project;
            setProjectId(project.id);

            // Set the preview URL based on the subdomain
            const previewURL = `http://${project.subDomain}.localhost:8000`;
            setDeployPreviewURL(previewURL);

            // Log information about the deployment
            setLogs(prev => [...prev, `Created project: ${project.name}`]);
            setLogs(prev => [...prev, `Subdomain: ${project.subDomain}`]);
            setLogs(prev => [...prev, `Preview URL will be: ${previewURL}`]);

            // Then trigger a deployment
            const { data: deployData } = await axios.post(`http://localhost:9000/deploy`, {
                projectId: project.id
            });

            if (deployData?.data?.deploymentId) {
                const deployId = deployData.data.deploymentId;
                setDeploymentId(deployId);

                // Start polling for logs
                setPollingLogs(true);

                // Still use socket for real-time updates
                socket.emit("subscribe", `logs:${deployId}`);
                setLogs(prev => [...prev, `Deployment started with ID: ${deployId}`]);
            }
        }
    } catch (error) {
        console.error("Deployment error:", error);
        let errorMsg = "Unknown error occurred";
        if (error instanceof Error) {
            errorMsg = error.message;
        }
        setLogs(prev => [...prev, `Error: ${errorMsg}`]);
    } finally {
        setLoading(false);
    }
}, [repoURL]);

  const handleSocketIncommingMessage = useCallback((message: string) => {
    try {
      const { log } = JSON.parse(message);
      setLogs((prev) => [...prev, log]);
      logContainerRef.current?.scrollIntoView({ behavior: "smooth" });
    } catch (error) {
      console.error("Error parsing socket message:", error);
    }
  }, []);

  useEffect(() => {
    socket.on("message", handleSocketIncommingMessage);
    return () => {
      socket.off("message", handleSocketIncommingMessage);
    };
  }, [handleSocketIncommingMessage]);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    if (deploymentId && pollingLogs) {
      fetchDeploymentLogs(deploymentId);

      interval = setInterval(() => {
        fetchDeploymentLogs(deploymentId);
      }, 5000);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [deploymentId, pollingLogs]);

  const fetchDeploymentLogs = async (deployId: string) => {
    try {
      const response = await axios.get(`http://localhost:9000/logs/${deployId}`);
      if (response.data && response.data.logs) {
        // Update logs, but avoid duplicates
        setLogs(prevLogs => {
          const newLogs = response.data.logs.map((log: any) => log.log);
          const uniqueNewLogs = newLogs.filter(
            (log: string) => !prevLogs.includes(log)
          );

          if (uniqueNewLogs.length > 0) {
            return [...prevLogs, ...uniqueNewLogs];
          }
          return prevLogs;
        });

        // Check if deployment is complete
        const deploymentStatus = response.data.status;
        if (deploymentStatus === 'READY') {
          setPollingLogs(false);
          setLogs(prev => [...prev, 'Deployment complete! Site is ready.']);
        } else if (deploymentStatus === 'FAIL') {
          setPollingLogs(false);
          setLogs(prev => [...prev, 'Deployment failed! Check logs for details.']);
        }
      }
    } catch (error) {
      console.error('Error fetching logs:', error);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      <MouseParticles />

      <div className="fixed inset-0 bg-[url('/grid.svg')] bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))]"></div>

      <div className="container mx-auto py-10 px-4 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex flex-col items-center justify-center"
        >
          <h1 className="text-4xl md:text-6xl font-bold mb-6 bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-400">
            Cloudara
          </h1>
          <p className="text-center text-lg mb-10 max-w-2xl">
            Deploy your applications with just a GitHub URL. Fast, simple, and seamless.
          </p>

          <motion.div
            className="w-full max-w-2xl backdrop-blur-sm bg-white/10 p-8 rounded-xl shadow-xl border border-white/20"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
          >
            <div className="space-y-6">
              <div className="space-y-4">
                <label className="block text-sm font-medium mb-1">GitHub Repository</label>
                <span className="flex justify-start items-center gap-2 p-1 rounded-lg bg-white/5 border border-white/10 hover:border-indigo-400/50 focus-within:border-indigo-400 transition-colors">
                  <Github className="text-3xl ml-3 text-indigo-300" />
                  <Input
                    disabled={loading}
                    value={repoURL}
                    onChange={(e) => setURL(e.target.value)}
                    type="url"
                    placeholder="Enter GitHub URL (e.g. https://github.com/username/repo)"
                    className="flex-1 border-none bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-white"
                  />
                </span>

                {repoURL && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className={`mt-1 text-sm ${isValidURL[0] ? 'text-green-400' : 'text-red-400'}`}
                  >
                    {isValidURL[0] ? '✓ Valid GitHub URL' : 'ⅹ Invalid GitHub URL format'}
                  </motion.div>
                )}
              </div>

              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Button
                  onClick={handleClickDeploy}
                  disabled={!isValidURL[0] || loading}
                  className="w-full py-6 text-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white border-none"
                >
                  {loading ? (
                    <div className="flex items-center">
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Deploying...
                    </div>
                  ) : "Deploy"}
                </Button>
              </motion.div>
            </div>

            <AnimatePresence>
              {deployPreviewURL && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-6 bg-indigo-900/30 py-4 px-4 rounded-lg border border-indigo-400/20"
                >
                  <p className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                    <span className="font-medium">Preview URL:</span>
                    <a
                      target="_blank"
                      className="text-indigo-300 bg-indigo-950/40 px-3 py-2 rounded-lg hover:bg-indigo-900/60 transition-colors truncate max-w-full inline-block"
                      href={deployPreviewURL}
                    >
                      {deployPreviewURL}
                    </a>
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {logs.length > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className={`${firaCode.className} text-sm text-green-400 logs-container mt-6 border-green-500/20 border-2 rounded-lg p-4 h-[300px] overflow-y-auto bg-black/30`}
                >
                  <pre className="flex flex-col gap-1">
                    {logs.map((log, i) => (
                      <motion.code
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.03 }}
                        ref={logs.length - 1 === i ? logContainerRef : undefined}
                        key={i}
                        className="whitespace-pre-wrap break-all"
                      >{`> ${log}`}</motion.code>
                    ))}
                  </pre>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      </div>

      <footer className="text-center py-6 text-white/50 text-sm relative z-10">
        Built with ❤️ using Next.js, Tailwind CSS & NodeJS
      </footer>
    </main>
  );
}
