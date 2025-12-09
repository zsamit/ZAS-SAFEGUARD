/**
 * ZAS Safeguard - Android Overlay Service
 * 
 * Shows a blocking overlay when harmful content is detected.
 */

package com.zas.safeguard

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.TextView
import androidx.core.app.NotificationCompat

class OverlayService : Service() {
    
    companion object {
        private const val CHANNEL_ID = "zas_overlay_channel"
        private const val NOTIFICATION_ID = 1001
        private const val OVERLAY_DURATION_MS = 5000L
    }
    
    private var windowManager: WindowManager? = null
    private var overlayView: View? = null
    private val handler = Handler(Looper.getMainLooper())
    
    private val motivationalMessages = listOf(
        "Every time you resist temptation, you become stronger.",
        "Your future self will thank you for this moment of strength.",
        "This urge is temporary. Your goals are permanent.",
        "You're building habits that will change your life.",
        "Stay focused on what truly matters to you.",
        "You have the power to choose what influences your mind."
    )
    
    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        createNotificationChannel()
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            "SHOW_BLOCK" -> {
                val blockedContent = intent.getStringExtra("blocked_content") ?: "Unknown"
                showBlockingOverlay(blockedContent)
            }
            "DISMISS" -> {
                dismissOverlay()
            }
        }
        
        // Start as foreground service
        startForeground(NOTIFICATION_ID, createNotification())
        
        return START_STICKY
    }
    
    override fun onBind(intent: Intent?): IBinder? = null
    
    override fun onDestroy() {
        super.onDestroy()
        dismissOverlay()
    }
    
    private fun showBlockingOverlay(blockedContent: String) {
        if (overlayView != null) {
            dismissOverlay()
        }
        
        val layoutParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else
                WindowManager.LayoutParams.TYPE_SYSTEM_ALERT,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        )
        layoutParams.gravity = Gravity.CENTER
        
        overlayView = createOverlayView(blockedContent)
        
        try {
            windowManager?.addView(overlayView, layoutParams)
            
            // Auto-dismiss after duration
            handler.postDelayed({
                dismissOverlay()
            }, OVERLAY_DURATION_MS)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
    
    private fun createOverlayView(blockedContent: String): View {
        val view = LayoutInflater.from(this).inflate(R.layout.overlay_blocked, null)
        
        // Set motivational message
        val messageText = view.findViewById<TextView>(R.id.motivational_message)
        messageText?.text = motivationalMessages.random()
        
        // Set blocked content info
        val blockedText = view.findViewById<TextView>(R.id.blocked_content)
        blockedText?.text = "Blocked: $blockedContent"
        
        // Dismiss button
        val dismissButton = view.findViewById<Button>(R.id.dismiss_button)
        dismissButton?.setOnClickListener {
            dismissOverlay()
        }
        
        return view
    }
    
    private fun dismissOverlay() {
        overlayView?.let {
            try {
                windowManager?.removeView(it)
            } catch (e: Exception) {
                // Already removed
            }
            overlayView = null
        }
    }
    
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "ZAS Safeguard Protection",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows when protection is active"
                setSound(null, null)
            }
            
            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
        }
    }
    
    private fun createNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("ZAS Safeguard Active")
            .setContentText("Protecting you from harmful content")
            .setSmallIcon(R.drawable.ic_shield)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build()
    }
}
