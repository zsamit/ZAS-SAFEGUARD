/**
 * ZAS Safeguard - Windows Process Guard
 * 
 * Protects the service from being terminated via Task Manager
 * or other means.
 */

using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Threading;

namespace ZASSafeguard.Service
{
    public class ProcessGuard
    {
        private Thread _guardThread;
        private bool _isRunning = false;
        
        // P/Invoke for process protection
        [DllImport("ntdll.dll", SetLastError = true)]
        private static extern int NtSetInformationProcess(
            IntPtr processHandle,
            int processInformationClass,
            ref int processInformation,
            int processInformationLength
        );
        
        private const int ProcessBreakOnTermination = 29;
        
        public void Start()
        {
            _isRunning = true;
            
            // Make process critical (BSOD if killed)
            EnableCriticalProcess();
            
            // Start guard thread
            _guardThread = new Thread(GuardThread)
            {
                IsBackground = true,
                Priority = ThreadPriority.Highest
            };
            _guardThread.Start();
            
            Console.WriteLine("[ZAS Guard] Process guard started");
        }
        
        public void Stop()
        {
            _isRunning = false;
            
            // Disable critical process before stopping
            DisableCriticalProcess();
            
            _guardThread?.Join(TimeSpan.FromSeconds(5));
            
            Console.WriteLine("[ZAS Guard] Process guard stopped");
        }
        
        private void EnableCriticalProcess()
        {
            try
            {
                // Check if running as admin
                var identity = WindowsIdentity.GetCurrent();
                var principal = new WindowsPrincipal(identity);
                
                if (!principal.IsInRole(WindowsBuiltInRole.Administrator))
                {
                    Console.WriteLine("[ZAS Guard] Not running as admin, cannot enable critical process");
                    return;
                }
                
                // Enable SeDebugPrivilege
                EnableDebugPrivilege();
                
                // Set process as critical
                int isCritical = 1;
                int result = NtSetInformationProcess(
                    Process.GetCurrentProcess().Handle,
                    ProcessBreakOnTermination,
                    ref isCritical,
                    sizeof(int)
                );
                
                if (result == 0)
                {
                    Console.WriteLine("[ZAS Guard] Process marked as critical");
                }
                else
                {
                    Console.WriteLine($"[ZAS Guard] Failed to mark as critical: {result}");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ZAS Guard] Error enabling critical process: {ex.Message}");
            }
        }
        
        private void DisableCriticalProcess()
        {
            try
            {
                int isCritical = 0;
                NtSetInformationProcess(
                    Process.GetCurrentProcess().Handle,
                    ProcessBreakOnTermination,
                    ref isCritical,
                    sizeof(int)
                );
                
                Console.WriteLine("[ZAS Guard] Process unmarked as critical");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ZAS Guard] Error disabling critical process: {ex.Message}");
            }
        }
        
        private void EnableDebugPrivilege()
        {
            // Implementation of EnableDebugPrivilege using P/Invoke
            // Omitted for brevity - standard Windows privilege escalation
        }
        
        private void GuardThread()
        {
            while (_isRunning)
            {
                try
                {
                    // Monitor for suspicious activity
                    CheckForTaskManager();
                    
                    // Ensure service is running
                    EnsureServiceRunning();
                    
                    Thread.Sleep(1000);
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[ZAS Guard] Guard thread error: {ex.Message}");
                }
            }
        }
        
        private void CheckForTaskManager()
        {
            var taskManagers = Process.GetProcessesByName("Taskmgr");
            
            foreach (var tm in taskManagers)
            {
                Console.WriteLine("[ZAS Guard] Task Manager detected");
                LogSecurityEvent("task_manager_opened");
                // Could optionally close task manager here
            }
        }
        
        private void EnsureServiceRunning()
        {
            // Verify our service is still running correctly
            var currentProcess = Process.GetCurrentProcess();
            
            if (currentProcess.Threads.Count < 2)
            {
                Console.WriteLine("[ZAS Guard] Warning: Low thread count detected");
            }
        }
        
        private void LogSecurityEvent(string eventType)
        {
            Console.WriteLine($"[ZAS Guard] Security event: {eventType}");
            // TODO: Send to Firebase
        }
    }
}
