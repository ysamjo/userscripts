property sizeCaches : {}
property lastTargetFolder : missing value
property defaultTargetFolderPath : "/Users/family/Library/CloudStorage/OneDrive-Persönlich/Bilder/Eigene Aufnahmen"
property preferencesDomain : "com.family.Monate"

on run
	set sizeCaches to {}
	set targetFolder to my chooseTargetFolder()
	if targetFolder is missing value then return
	set lastTargetFolder to targetFolder
	my rememberTargetFolder(targetFolder)

	tell application "Finder"
		set allFiles to every file of targetFolder
		
		repeat with f in allFiles
			set sourceName to name of f
			set sourceSize to size of f
			set sourceExtension to my fileExtension(sourceName)
			set {imageWidth, imageHeight} to {0, 0}
			if my needsDimensionCheck(sourceExtension, sourceSize) then
				set {imageWidth, imageHeight} to my imageDimensions(f as alias)
			end if
			
			set cDate to creation date of f
			set theYear to year of cDate as string
			set theMonth to text -2 thru -1 of ("0" & ((month of cDate) as integer) as string)
			set destinationFolderName to theYear & "." & theMonth
			
			if my isScreenshot(sourceName, sourceExtension, sourceSize, imageWidth, imageHeight) then
				set destinationFolderName to "Screenshots"
			else if my isSmallMeme(sourceName, sourceExtension, sourceSize, imageWidth, imageHeight) then
				set destinationFolderName to "Memes"
			end if
			
			if not (exists folder destinationFolderName of targetFolder) then
				make new folder at targetFolder with properties {name:destinationFolderName}
			end if
			
			set destFolder to folder destinationFolderName of targetFolder
			
			if sourceName is not destinationFolderName then
				if my hasDuplicateSize(sourceSize, destinationFolderName, destFolder) then
					delete f
				else if exists file sourceName of destFolder then
					set newName to my uniqueName(sourceName, destFolder)
					set name of f to newName
					move f to destFolder
					my rememberSize(sourceSize, destinationFolderName, destFolder)
				else
					move f to destFolder
					my rememberSize(sourceSize, destinationFolderName, destFolder)
				end if
			end if
		end repeat
	end tell
end run

on chooseTargetFolder()
	set defaultFolder to missing value
	try
		set savedPath to do shell script "/usr/bin/defaults read " & preferencesDomain & " lastTargetFolder 2>/dev/null"
		if savedPath is not "" then set defaultFolder to POSIX file savedPath as alias
	end try
	if defaultFolder is missing value then try
		if lastTargetFolder is not missing value then set defaultFolder to lastTargetFolder as alias
	end try
	if defaultFolder is missing value then set defaultFolder to POSIX file defaultTargetFolderPath as alias
	try
		return choose folder with prompt "Welchen Ordner sollen die Bilder sortiert werden?" default location defaultFolder
	on error number -128
		return missing value
	end try
end chooseTargetFolder

on rememberTargetFolder(targetFolder)
	try
		set targetPath to POSIX path of targetFolder
		do shell script "/usr/bin/defaults write " & preferencesDomain & " lastTargetFolder -string " & quoted form of targetPath
	end try
end rememberTargetFolder

on isScreenshot(sourceName, sourceExtension, sourceSize, imageWidth, imageHeight)
	ignoring case
		if sourceExtension is "png" then return true
		if sourceName contains "screenshot" then return true
		if sourceName contains "bildschirmfoto" then return true
		if sourceName contains "screen shot" then return true
	end ignoring
	if sourceSize ≤ 1048576 and imageWidth ≥ 700 and imageHeight ≥ 1600 then
		if (imageHeight / imageWidth) ≥ 1.7 then return true
	end if
	return false
end isScreenshot

on isSmallMeme(sourceName, sourceExtension, sourceSize, imageWidth, imageHeight)
	ignoring case
		if sourceName contains "meme" or sourceName contains "sticker" then return true
		if sourceExtension is in {"gif", "webp"} and sourceSize ≤ 1048576 then return true
	end ignoring
	if sourceSize > 524288 then return false
	if imageWidth > 0 and imageHeight > 0 and imageWidth ≤ 1200 and imageHeight ≤ 1200 then return true
	return false
end isSmallMeme

on needsDimensionCheck(sourceExtension, sourceSize)
	if sourceSize > 1048576 then return false
	ignoring case
		return sourceExtension is in {"jpg", "jpeg", "gif", "webp"}
	end ignoring
end needsDimensionCheck

on imageDimensions(sourceAlias)
	set sourcePath to POSIX path of sourceAlias
	set commandText to "/usr/bin/sips -g pixelWidth -g pixelHeight " & quoted form of sourcePath & " 2>/dev/null | /usr/bin/awk '/pixelWidth:/ {w=$2} /pixelHeight:/ {h=$2} END {print w, h}'"
	try
		set dimensionText to do shell script commandText
		set dimensionWords to words of dimensionText
		if (count of dimensionWords) ≥ 2 then return {(item 1 of dimensionWords) as integer, (item 2 of dimensionWords) as integer}
	end try
	return {0, 0}
end imageDimensions

on fileExtension(sourceName)
	set dotOffset to my lastDotOffset(sourceName)
	if dotOffset is 0 or dotOffset is (length of sourceName) then return ""
	return text (dotOffset + 1) thru -1 of sourceName
end fileExtension

on uniqueName(sourceName, destFolder)
	set {baseName, fileSuffix} to my splitName(sourceName)
	set counter to 1
	tell application "Finder"
		repeat
			set candidateName to baseName & " (" & counter & ")" & fileSuffix
			if not (exists file candidateName of destFolder) then exit repeat
			set counter to counter + 1
		end repeat
	end tell
	return candidateName
end uniqueName

on hasDuplicateSize(sourceSize, monthFolderName, destFolder)
	set knownSizes to my sizeCacheForMonth(monthFolderName, destFolder)
	return knownSizes contains sourceSize
end hasDuplicateSize

on rememberSize(sourceSize, monthFolderName, destFolder)
	my sizeCacheForMonth(monthFolderName, destFolder)
	repeat with cacheEntry in sizeCaches
		if monthKey of cacheEntry is monthFolderName then
			set end of knownSizes of cacheEntry to sourceSize
			return
		end if
	end repeat
end rememberSize

on sizeCacheForMonth(monthFolderName, destFolder)
	repeat with cacheEntry in sizeCaches
		if monthKey of cacheEntry is monthFolderName then return knownSizes of cacheEntry
	end repeat
	tell application "Finder"
		try
			set destSizes to size of every file of destFolder
		on error
			set destSizes to {}
		end try
	end tell
	script newCache
		property monthKey : missing value
		property knownSizes : {}
	end script
	set monthKey of newCache to monthFolderName
	set knownSizes of newCache to destSizes
	set end of sizeCaches to newCache
	return knownSizes of newCache
end sizeCacheForMonth

on splitName(sourceName)
	set dotOffset to my lastDotOffset(sourceName)
	if dotOffset is 0 then return {sourceName, ""}
	return {text 1 thru (dotOffset - 1) of sourceName, text dotOffset thru -1 of sourceName}
end splitName

on lastDotOffset(sourceName)
	repeat with i from (length of sourceName) to 1 by -1
		if character i of sourceName is "." then return i
	end repeat
	return 0
end lastDotOffset
