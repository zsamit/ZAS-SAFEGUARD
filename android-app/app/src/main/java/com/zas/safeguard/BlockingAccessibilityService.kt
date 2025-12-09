/**
 * ZAS Safeguard - Android Blocking Accessibility Service
 * 
 * Uses Android's Accessibility Service to monitor app launches
 * and browser URL bars to block harmful content.
 */

package com.zas.safeguard

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.util.concurrent.ConcurrentHashMap

class BlockingAccessibilityService : AccessibilityService() {
    
    companion object {
        private const val TAG = "ZAS-Blocker"
        
        // Default blocked domains
        private val DEFAULT_BLOCKED = setOf(
            "pornhub.com", "xvideos.com", "xnxx.com", "xhamster.com",
            "redtube.com", "youporn.com", "tube8.com", "spankbang.com",
            "porn.com", "brazzers.com", "bangbros.com"
        )
        
        // Blocked app packages
        private val BLOCKED_APPS = setOf(
            "com.pornhub.android",
            // Add more blocked app packages
        )
        
        // Browser packages
        private val BROWSERS = setOf(
            "com.android.chrome",
            "com.chrome.beta",
            "com.chrome.dev",
            "org.mozilla.firefox",
            "com.opera.browser",
            "com.brave.browser",
            "com.microsoft.emmx",
            "com.samsung.android.app.sbrowser"
        )
    }
    
    private var blockedDomains = ConcurrentHashMap.newKeySet<String>()
    private var lastBlockedUrl: String? = null
    private var lastBlockTime: Long = 0
    
    override fun onServiceConnected() {
        super.onServiceConnected()
        Log.i(TAG, "Accessibility Service connected")
        
        // Load blocked domains
        blockedDomains.addAll(DEFAULT_BLOCKED)
        
        // Configure service
        val info = AccessibilityServiceInfo().apply {
            eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
                    AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED or
                    AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            flags = AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS or
                    AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
            notificationTimeout = 100
        }
        serviceInfo = info
        
        // Sync blocklist from Firebase
        syncBlocklist()
    }
    
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        event ?: return
        
        val packageName = event.packageName?.toString() ?: return
        
        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                // Check if blocked app was launched
                if (isBlockedApp(packageName)) {
                    Log.i(TAG, "Blocked app detected: $packageName")
                    showBlockingOverlay(packageName)
                    return
                }
                
                // Check browser URL
                if (isBrowser(packageName)) {
                    checkBrowserUrl(event)
                }
            }
            
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED,
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED -> {
                if (isBrowser(packageName)) {
                    checkBrowserUrl(event)
                }
            }
        }
    }
    
    override fun onInterrupt() {
        Log.w(TAG, "Accessibility Service interrupted")
    }
    
    private fun isBlockedApp(packageName: String): Boolean {
        return BLOCKED_APPS.contains(packageName)
    }
    
    private fun isBrowser(packageName: String): Boolean {
        return BROWSERS.contains(packageName)
    }
    
    private fun checkBrowserUrl(event: AccessibilityEvent) {
        val rootNode = rootInActiveWindow ?: return
        
        // Find URL bar content
        val url = findUrlInNode(rootNode)
        rootNode.recycle()
        
        if (url != null && shouldBlockUrl(url)) {
            // Prevent rapid-fire blocking
            val now = System.currentTimeMillis()
            if (url != lastBlockedUrl || now - lastBlockTime > 2000) {
                lastBlockedUrl = url
                lastBlockTime = now
                
                Log.i(TAG, "Blocking URL: $url")
                showBlockingOverlay(url)
                logBlockEvent(url)
                performGlobalAction(GLOBAL_ACTION_BACK)
            }
        }
    }
    
    private fun findUrlInNode(node: AccessibilityNodeInfo): String? {
        // Common URL bar view IDs for popular browsers
        val urlBarIds = listOf(
            "com.android.chrome:id/url_bar",
            "com.android.chrome:id/search_box_text",
            "org.mozilla.firefox:id/url_bar_title",
            "org.mozilla.firefox:id/mozac_browser_toolbar_url_view",
            "com.opera.browser:id/url_field",
            "com.brave.browser:id/url_bar",
            "com.microsoft.emmx:id/url_bar"
        )
        
        for (urlBarId in urlBarIds) {
            val urlNodes = node.findAccessibilityNodeInfosByViewId(urlBarId)
            if (urlNodes.isNotEmpty()) {
                val text = urlNodes[0].text?.toString()
                urlNodes.forEach { it.recycle() }
                if (text != null) return text
            }
        }
        
        // Fallback: search for EditText with URL-like content
        return findUrlInChildren(node)
    }
    
    private fun findUrlInChildren(node: AccessibilityNodeInfo): String? {
        val text = node.text?.toString()
        if (text != null && (text.contains("http") || text.contains(".com") || text.contains(".net"))) {
            return text
        }
        
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val result = findUrlInChildren(child)
            child.recycle()
            if (result != null) return result
        }
        
        return null
    }
    
    private fun shouldBlockUrl(url: String): Boolean {
        val lowerUrl = url.lowercase()
        
        for (domain in blockedDomains) {
            if (lowerUrl.contains(domain)) {
                return true
            }
        }
        
        return false
    }
    
    private fun showBlockingOverlay(blockedContent: String) {
        val intent = Intent(this, OverlayService::class.java).apply {
            action = "SHOW_BLOCK"
            putExtra("blocked_content", blockedContent)
        }
        startService(intent)
    }
    
    private fun logBlockEvent(url: String) {
        // Send to Firebase
        Log.i(TAG, "Block logged: $url")
        // TODO: Implement Firebase logging
    }
    
    private fun syncBlocklist() {
        // Sync blocked domains from Firebase
        Log.i(TAG, "Syncing blocklist...")
        // TODO: Implement Firebase sync
    }
    
    fun updateBlockedDomains(domains: Set<String>) {
        blockedDomains.clear()
        blockedDomains.addAll(DEFAULT_BLOCKED) // Always include defaults
        blockedDomains.addAll(domains)
        Log.i(TAG, "Blocklist updated: ${blockedDomains.size} domains")
    }
}
